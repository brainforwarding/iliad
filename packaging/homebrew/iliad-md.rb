cask "iliad-md" do
  version "0.3.2"
  sha256 "fdb0c7ad83c1d0f381e6a0b67eec47af43ff3b39248a858692d68fd1fd641892"

  url "https://github.com/brainforwarding/iliad/releases/download/v#{version}/Iliad-MD-#{version}-mac-arm64.dmg",
      verified: "github.com/brainforwarding/iliad/"
  name "Iliad MD"
  desc "Local-first Markdown writing workspace"
  homepage "https://iliad.md/"

  livecheck do
    url :url
    strategy :github_latest
  end

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
