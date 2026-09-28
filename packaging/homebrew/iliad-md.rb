cask "iliad-md" do
  version "0.6.1"
  sha256 "8fb1f01c0dd715d31ebf89dc04958e6a1a1d57c2d47dafa06dc0b42fe3136528"

  url "https://github.com/brainforwarding/iliad/releases/download/v#{version}/Iliad-MD-#{version}-mac-arm64.dmg",
      verified: "github.com/brainforwarding/iliad/"
  name "Iliad MD"
  desc "Local-first Markdown writing workspace"
  homepage "https://iliad.md/"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates true
  depends_on arch: :arm64
  depends_on macos: :monterey

  app "Iliad MD.app"
  binary "#{appdir}/Iliad MD.app/Contents/Resources/bin/iliad"

  zap trash: [
    "~/Library/Application Support/Iliad MD",
    "~/Library/Caches/md.iliad.app",
    "~/Library/HTTPStorages/md.iliad.app",
    "~/Library/Logs/Iliad MD",
    "~/Library/Preferences/md.iliad.app.plist",
    "~/Library/Saved Application State/md.iliad.app.savedState",
  ]
end
