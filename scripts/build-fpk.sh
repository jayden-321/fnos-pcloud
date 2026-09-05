#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
version=$(sed -n 's/^version=//p' "$project_dir/manifest" | head -n 1)
if [ -z "$version" ]; then
  echo "manifest version is required" >&2
  exit 1
fi

for required in manifest LICENSE ICON.PNG ICON_256.PNG cmd config app/docker app/ui; do
  if [ ! -e "$project_dir/$required" ]; then
    echo "missing package path: $required" >&2
    exit 1
  fi
done

staging_dir=$(mktemp -d "${TMPDIR:-/tmp}/pcloud-fpk.XXXXXX")
trap 'rm -r "$staging_dir"' EXIT HUP INT TERM
mkdir -p "$staging_dir/package/wizard" "$project_dir/outputs"

# fnOS install hooks must not inherit the build machine's macOS UID/group.
package_tar() {
  case "$(tar --version)" in
    *bsdtar*) COPYFILE_DISABLE=1 tar --uid 0 --gid 0 --uname root --gname root "$@" ;;
    *) COPYFILE_DISABLE=1 tar --owner=0 --group=0 "$@" ;;
  esac
}

package_tar -czf "$staging_dir/package/app.tgz" -C "$project_dir/app" docker ui
cp "$project_dir/manifest" "$project_dir/LICENSE" "$project_dir/ICON.PNG" "$project_dir/ICON_256.PNG" "$staging_dir/package/"
cp -R "$project_dir/cmd" "$project_dir/config" "$staging_dir/package/"

if command -v md5sum >/dev/null 2>&1; then
  checksum=$(md5sum "$staging_dir/package/app.tgz" | awk '{print $1}')
else
  checksum=$(md5 -q "$staging_dir/package/app.tgz")
fi
sed '/^checksum[[:space:]]*=/d' "$staging_dir/package/manifest" > "$staging_dir/manifest"
printf '\nchecksum=%s\n' "$checksum" >> "$staging_dir/manifest"
mv "$staging_dir/manifest" "$staging_dir/package/manifest"

output="$project_dir/outputs/pcloud-nas-sync-$version.fpk"
package_tar -czf "$output" -C "$staging_dir/package" app.tgz LICENSE cmd config ICON.PNG ICON_256.PNG manifest wizard
echo "$output"
