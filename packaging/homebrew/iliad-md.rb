cask "iliad-md" do
  version "0.8.0"
  sha256 "510a7eea47794bbfbae44af19122b4ec4879c1d6ea00c75a37b6bbec352e5fb2"

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
