package images

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"net/url"
)

type ImgproxyConfig struct {
	Enabled bool
	Key     string // hex-encoded
	Salt    string // hex-encoded
	BaseURL string // e.g. http://imgproxy:8080
}

// SignURL generates a signed imgproxy URL for a local file.
// storageKey is the relative path within the local filesystem root.
// width, height: resize dimensions (0 = auto)
func (c *ImgproxyConfig) SignURL(storageKey string, width, height int) string {
	sourceURL := "local:///" + storageKey
	processingOptions := fmt.Sprintf("rs:fit:%d:%d/g:sm", width, height)
	path := fmt.Sprintf("/%s/plain/%s", processingOptions, url.QueryEscape(sourceURL))

	keyBytes, _ := hex.DecodeString(c.Key)
	saltBytes, _ := hex.DecodeString(c.Salt)

	mac := hmac.New(sha256.New, keyBytes)
	mac.Write(saltBytes)
	mac.Write([]byte(path))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))

	return fmt.Sprintf("%s/%s%s", c.BaseURL, sig, path)
}
