package proxy

import (
	"bytes"
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"log"
	"net"
	"os"
	"sync"
	"time"

	"baseful/auth"
	"baseful/db"
)

const (
	DefaultPort = 6432
)

type ProxyServer struct {
	listener net.Listener
	port     int
	ctx      context.Context
	cancel   context.CancelFunc
	wg       sync.WaitGroup
}

func NewProxyServer(port int) *ProxyServer {
	if port == 0 {
		port = DefaultPort
	}
	ctx, cancel := context.WithCancel(context.Background())
	return &ProxyServer{
		port:   port,
		ctx:    ctx,
		cancel: cancel,
	}
}

func (p *ProxyServer) Start() error {
	addr := fmt.Sprintf(":%d", p.port)
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	p.listener = listener
	log.Printf("[Proxy] Listening on %s", addr)

	p.wg.Add(1)
	go func() {
		defer p.wg.Done()
		for {
			conn, err := p.listener.Accept()
			if err != nil {
				select {
				case <-p.ctx.Done():
					return
				default:
					log.Printf("[Proxy] Accept error: %v", err)
					continue
				}
			}
			p.wg.Add(1)
			go p.handleConnection(conn)
		}
	}()
	return nil
}

func (p *ProxyServer) handleConnection(frontend net.Conn) {
	defer p.wg.Done()
	defer frontend.Close()

	// 1. Handle Frontend Handshake (JWT Auth)
	frontend.SetDeadline(time.Now().Add(15 * time.Second))

	startupParams, jwtToken, err := p.handleFrontendHandshake(frontend)
	if err != nil {
		log.Printf("[Proxy] Frontend handshake failed: %v", err)
		return
	}

	// 2. Validate JWT
	claims, err := auth.ValidateJWT(jwtToken)
	if err != nil {
		p.sendError(frontend, "28000", "Invalid JWT token")
		return
	}

	// 3. Get Backend Info
	dbInfo, err := db.GetDatabaseByID(claims.DatabaseID)
	if err != nil {
		p.sendError(frontend, "3D000", "Database not found")
		return
	}

	// 4. Connect and Handshake with Backend
	// Try connecting to the internal host first (for Docker-to-Docker)
	backendHost := dbInfo.Host
	backendPort := dbInfo.Port

	backend, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", backendHost, backendPort), 200*time.Millisecond)

	// If internal connection fails and we have a mapped port, try connecting via localhost (for Host-to-Docker)
	if err != nil && dbInfo.MappedPort > 0 {
		log.Printf("[Proxy] internal connection failed (%v), trying localhost:%d", err, dbInfo.MappedPort)
		backendHost = "127.0.0.1"
		backendPort = dbInfo.MappedPort
		backend, err = net.DialTimeout("tcp", fmt.Sprintf("%s:%d", backendHost, backendPort), 5*time.Second)
	}

	if err != nil {
		p.sendError(frontend, "08006", fmt.Sprintf("Failed to connect to backend database at %s:%d", dbInfo.Host, dbInfo.Port))
		return
	}
	defer backend.Close()

	err = p.handleBackendHandshake(backend, dbInfo, startupParams, frontend)
	if err != nil {
		log.Printf("[Proxy] Backend handshake failed: %v", err)
		return
	}

	// 5. Synchronized! Both are now at ReadyForQuery.
	frontend.SetDeadline(time.Time{})
	log.Printf("[Proxy] Connection synchronized for DB %d. Piping...", claims.DatabaseID)

	errChan := make(chan error, 2)
	go func() { errChan <- p.pipe(frontend, backend) }()
	go func() { errChan <- p.pipe(backend, frontend) }()

	<-errChan
}

func (p *ProxyServer) handleFrontendHandshake(conn net.Conn) (map[string]string, string, error) {
	// Read Length
	lenBuf := make([]byte, 4)
	if _, err := io.ReadFull(conn, lenBuf); err != nil {
		return nil, "", err
	}
	length := binary.BigEndian.Uint32(lenBuf)

	// Handle SSL Request
	if length == 8 {
		codeBuf := make([]byte, 4)
		io.ReadFull(conn, codeBuf)
		if binary.BigEndian.Uint32(codeBuf) == 80877103 {
			conn.Write([]byte{'N'}) // No SSL
			if _, err := io.ReadFull(conn, lenBuf); err != nil {
				return nil, "", err
			}
			length = binary.BigEndian.Uint32(lenBuf)
		}
	}

	// Read StartupMessage
	payload := make([]byte, length-4)
	if _, err := io.ReadFull(conn, payload); err != nil {
		return nil, "", err
	}

	params := make(map[string]string)
	data := payload[4:] // skip protocol version
	for {
		idx := bytes.IndexByte(data, 0)
		if idx <= 0 {
			break
		}
		key := string(data[:idx])
		data = data[idx+1:]

		idx = bytes.IndexByte(data, 0)
		if idx < 0 {
			break
		}
		val := string(data[:idx])
		data = data[idx+1:]
		params[key] = val
	}

	// Request Password (JWT)
	// 'R' + length(8) + code(3) for CleartextPassword
	conn.Write([]byte{'R', 0, 0, 0, 8, 0, 0, 0, 3})

	// Read PasswordMessage
	header := make([]byte, 5)
	if _, err := io.ReadFull(conn, header); err != nil {
		return nil, "", err
	}
	if header[0] != 'p' {
		return nil, "", fmt.Errorf("expected password message, got %c", header[0])
	}
	passLen := binary.BigEndian.Uint32(header[1:5])
	passPayload := make([]byte, passLen-4)
	io.ReadFull(conn, passPayload)
	jwtToken := string(bytes.TrimSuffix(passPayload, []byte{0}))

	// Send Auth OK to frontend immediately so it knows we accepted the "password"
	// 'R' + length(8) + code(0)
	conn.Write([]byte{'R', 0, 0, 0, 8, 0, 0, 0, 0})

	return params, jwtToken, nil
}

func (p *ProxyServer) handleBackendHandshake(backend net.Conn, dbInfo *db.DatabaseInfo, params map[string]string, frontend net.Conn) error {
	// 1. Send Startup to Backend
	var buf bytes.Buffer
	binary.Write(&buf, binary.BigEndian, uint32(196608)) // Protocol 3.0
	for k, v := range params {
		if k == "user" {
			v = "postgres"
		} // Force backend user
		if k == "database" {
			v = dbInfo.Name // Use the actual database name stored in DB
		}
		buf.WriteString(k)
		buf.WriteByte(0)
		buf.WriteString(v)
		buf.WriteByte(0)
	}
	buf.WriteByte(0)

	msgLen := uint32(buf.Len() + 4)
	backend.Write(append(uint32ToBytes(msgLen), buf.Bytes()...))

	// 2. Handle Backend Auth and ParameterStatus
	for {
		header := make([]byte, 5)
		if _, err := io.ReadFull(backend, header); err != nil {
			return err
		}
		t := header[0]
		l := binary.BigEndian.Uint32(header[1:5])
		payload := make([]byte, l-4)
		io.ReadFull(backend, payload)

		switch t {
		case 'R': // Authentication
			authType := binary.BigEndian.Uint32(payload)
			if authType == 0 { // Auth OK
				continue
			}
			if authType == 3 { // Cleartext requested
				resp := append([]byte{'p'}, uint32ToBytes(uint32(len(dbInfo.Password)+5))...)
				resp = append(resp, []byte(dbInfo.Password)...)
				resp = append(resp, 0)
				backend.Write(resp)
			} else if authType == 5 { // MD5 requested
				salt := payload[4:8]
				digest := md5Hash(dbInfo.Password, "postgres", salt)
				resp := append([]byte{'p'}, uint32ToBytes(uint32(len(digest)+5))...)
				resp = append(resp, []byte(digest)...)
				resp = append(resp, 0)
				backend.Write(resp)
			} else if authType == 10 { // SASL (SCRAM-SHA-256) requested
				if err := p.handleSCRAMAuth(backend, payload[4:], dbInfo.Password); err != nil {
					return err
				}
			} else {
				log.Printf("[Proxy] unsupported auth type: %d", authType)
			}
		case 'S': // ParameterStatus
			// Forward important server params to frontend
			msg := append([]byte{'S'}, uint32ToBytes(l)...)
			frontend.Write(append(msg, payload...))
		case 'Z': // ReadyForQuery
			// Backend is ready. Now tell frontend we are OK.
			// Auth OK was already sent in handleFrontendHandshake, so we just send ReadyForQuery
			frontend.Write(append([]byte{'Z', 0, 0, 0, 5}, payload...)) // ReadyForQuery
			return nil
		case 'E': // Error
			return fmt.Errorf("backend error: %s", string(payload))
		}
	}
}

func (p *ProxyServer) pipe(dst, src net.Conn) error {
	_, err := io.Copy(dst, src)
	return err
}

func (p *ProxyServer) sendError(conn net.Conn, code, message string) {
	var buf bytes.Buffer
	buf.WriteByte('S')
	buf.WriteString("FATAL")
	buf.WriteByte(0)
	buf.WriteByte('C')
	buf.WriteString(code)
	buf.WriteByte(0)
	buf.WriteByte('M')
	buf.WriteString(message)
	buf.WriteByte(0)
	buf.WriteByte(0)

	payload := buf.Bytes()
	header := append([]byte{'E'}, uint32ToBytes(uint32(len(payload)+4))...)
	conn.Write(append(header, payload...))
}

func uint32ToBytes(v uint32) []byte {
	b := make([]byte, 4)
	binary.BigEndian.PutUint32(b, v)
	return b
}

func Run() error {
	port := DefaultPort
	if pStr := os.Getenv("PROXY_PORT"); pStr != "" {
		fmt.Sscanf(pStr, "%d", &port)
	}
	server := NewProxyServer(port)
	return server.Start()
}
