package system

import (
	"fmt"
	"os/exec"
	"strings"
	"sync"
	"time"
)

type UpdateStatus struct {
	Available      bool      `json:"available"`
	CurrentHash    string    `json:"currentHash"`
	RemoteHash     string    `json:"remoteHash"`
	LastChecked    time.Time `json:"lastChecked"`
	CheckingStatus bool      `json:"checkingStatus"`
	UpdatingStatus bool      `json:"updatingStatus"`
}

var (
	currentStatus UpdateStatus
	statusMutex   sync.RWMutex
)

func InitUpdateChecker() {
	// Initial check
	go CheckForUpdates()

	// Periodic check every 30 minutes
	ticker := time.NewTicker(30 * time.Minute)
	go func() {
		for range ticker.C {
			CheckForUpdates()
		}
	}()
}

func CheckForUpdates() {
	statusMutex.Lock()
	currentStatus.CheckingStatus = true
	statusMutex.Unlock()

	defer func() {
		statusMutex.Lock()
		currentStatus.CheckingStatus = false
		currentStatus.LastChecked = time.Now()
		statusMutex.Unlock()
	}()

	// 1. Git fetch
	fetchCmd := exec.Command("git", "-C", "/repo", "fetch", "origin", "main")
	if err := fetchCmd.Run(); err != nil {
		fmt.Printf("Update check failed (fetch): %v\n", err)
		// Try without -C just in case we are running locally
		fetchLocal := exec.Command("git", "fetch", "origin", "main")
		fetchLocal.Run()
	}

	// 2. Get current hash
	currentCmd := exec.Command("git", "-C", "/repo", "rev-parse", "HEAD")
	currentOut, err := currentCmd.Output()
	if err != nil {
		// Fallback to local
		currentLocal := exec.Command("git", "rev-parse", "HEAD")
		currentOut, _ = currentLocal.Output()
	}
	currentHash := strings.TrimSpace(string(currentOut))

	// 3. Get remote hash
	remoteCmd := exec.Command("git", "-C", "/repo", "rev-parse", "origin/main")
	remoteOut, err := remoteCmd.Output()
	if err != nil {
		// Fallback to local
		remoteLocal := exec.Command("git", "rev-parse", "origin/main")
		remoteOut, _ = remoteLocal.Output()
	}
	remoteHash := strings.TrimSpace(string(remoteOut))

	statusMutex.Lock()
	currentStatus.CurrentHash = currentHash
	currentStatus.RemoteHash = remoteHash
	currentStatus.Available = currentHash != remoteHash
	statusMutex.Unlock()
}

func GetUpdateStatus() UpdateStatus {
	statusMutex.RLock()
	defer statusMutex.RUnlock()
	return currentStatus
}

func RunUpdate() error {
	statusMutex.Lock()
	currentStatus.UpdatingStatus = true
	statusMutex.Unlock()

	// 0. Ensure git safe directory
	exec.Command("git", "config", "--global", "--add", "safe.directory", "/repo").Run()

	// 1. Pull latest code
	pullCmd := exec.Command("git", "-C", "/repo", "pull", "origin", "main")
	if out, err := pullCmd.CombinedOutput(); err != nil {
		statusMutex.Lock()
		currentStatus.UpdatingStatus = false
		statusMutex.Unlock()
		return fmt.Errorf("git pull failed: %v, output: %s", err, string(out))
	}

	// 2. Build new images
	buildCmd := exec.Command("docker", "compose", "-f", "/repo/docker-compose.yml", "build")
	if _, err := buildCmd.CombinedOutput(); err != nil {
		buildCmd = exec.Command("docker-compose", "-f", "/repo/docker-compose.yml", "build")
		if out, err := buildCmd.CombinedOutput(); err != nil {
			statusMutex.Lock()
			currentStatus.UpdatingStatus = false
			statusMutex.Unlock()
			return fmt.Errorf("docker build failed: %v, output: %s", err, string(out))
		}
	}

	statusMutex.Lock()
	currentStatus.UpdatingStatus = false
	statusMutex.Unlock()

	// 3. Swap to new version
	go func() {
		// Wait a second for the response to reach the frontend
		time.Sleep(1 * time.Second)
		upCmd := exec.Command("docker", "compose", "-f", "/repo/docker-compose.yml", "up", "-d", "--remove-orphans")
		if _, err := upCmd.CombinedOutput(); err != nil {
			upCmd = exec.Command("docker-compose", "-f", "/repo/docker-compose.yml", "up", "-d", "--remove-orphans")
			upCmd.Run()
		}
	}()

	return nil
}
