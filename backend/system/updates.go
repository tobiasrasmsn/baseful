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
	fetchCmd := exec.Command("git", "fetch", "origin", "main")
	if err := fetchCmd.Run(); err != nil {
		fmt.Printf("Update check failed (fetch): %v\n", err)
		return
	}

	// 2. Get current hash
	currentCmd := exec.Command("git", "rev-parse", "HEAD")
	currentOut, err := currentCmd.Output()
	if err != nil {
		fmt.Printf("Update check failed (rev-parse HEAD): %v\n", err)
		return
	}
	currentHash := strings.TrimSpace(string(currentOut))

	// 3. Get remote hash
	remoteCmd := exec.Command("git", "rev-parse", "origin/main")
	remoteOut, err := remoteCmd.Output()
	if err != nil {
		fmt.Printf("Update check failed (rev-parse origin/main): %v\n", err)
		return
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
