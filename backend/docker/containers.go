package docker

import (
	"context"
	"fmt"
	"io"
	"strings"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/client"
)

type ContainerInfo struct {
	ID      string            `json:"id"`
	Names   []string          `json:"names"`
	Image   string            `json:"image"`
	Status  string            `json:"status"`
	State   string            `json:"state"`
	IP      string            `json:"ip"`
	Labels  map[string]string `json:"labels"`
	Created int64             `json:"created"`
}

// ListContainers returns a list of all containers on the Baseful network
func ListContainers() ([]ContainerInfo, error) {
	ctx := context.Background()
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return nil, fmt.Errorf("failed to create docker client: %w", err)
	}
	defer cli.Close()

	networkName := GetDockerNetworkName()

	// List all containers
	containers, err := cli.ContainerList(ctx, container.ListOptions{All: true})
	if err != nil {
		return nil, fmt.Errorf("failed to list containers: %w", err)
	}

	var result []ContainerInfo
	for _, c := range containers {
		// Get detailed info to find IP on our network
		inspect, err := cli.ContainerInspect(ctx, c.ID)
		if err != nil {
			continue
		}

		ip := ""
		if net, ok := inspect.NetworkSettings.Networks[networkName]; ok {
			ip = net.IPAddress
		}

		// Also check for containers managed by baseful even if not on network
		isBaseful := false
		if c.Labels["managed-by"] == "baseful" || strings.Contains(inspect.Name, "baseful") {
			isBaseful = true
		}

		if isBaseful || ip != "" {
			result = append(result, ContainerInfo{
				ID:      c.ID,
				Names:   c.Names,
				Image:   c.Image,
				Status:  c.Status,
				State:   c.State,
				IP:      ip,
				Labels:  c.Labels,
				Created: c.Created,
			})
		}
	}

	return result, nil
}

// ExecCommand executes a command in a container and returns the output
func ExecCommand(containerID string, cmd []string) (string, error) {
	ctx := context.Background()
	cli, err := client.NewClientWithOpts(client.FromEnv, client.WithAPIVersionNegotiation())
	if err != nil {
		return "", fmt.Errorf("failed to create docker client: %w", err)
	}
	defer cli.Close()

	// Create exec
	execConfig := container.ExecOptions{
		Cmd:          cmd,
		AttachStdout: true,
		AttachStderr: true,
		Tty:          false,
	}

	execID, err := cli.ContainerExecCreate(ctx, containerID, execConfig)
	if err != nil {
		return "", fmt.Errorf("failed to create exec: %w", err)
	}

	// Start exec
	resp, err := cli.ContainerExecAttach(ctx, execID.ID, container.ExecStartOptions{})
	if err != nil {
		return "", fmt.Errorf("failed to attach exec: %w", err)
	}
	defer resp.Close()

	// Read output
	output, err := io.ReadAll(resp.Reader)
	if err != nil {
		return "", fmt.Errorf("failed to read output: %w", err)
	}

	return string(output), nil
}
