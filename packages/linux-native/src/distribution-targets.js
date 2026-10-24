/** Native packaging capabilities. This inventory is safe to expose in the IDE. */
export const LINUX_NATIVE_DISTRIBUTION_FORMATS=Object.freeze({
  appimage:Object.freeze({label:'AppImage',extension:'.AppImage',mimeType:'application/vnd.appimage',
    authority:'node-native',platform:'linux',architectures:Object.freeze(['x64','arm64']),
    tools:Object.freeze(['mksquashfs','unsquashfs','readelf']),bundledSystemLibraries:true}),
  flatpak:Object.freeze({label:'Flatpak bundle',extension:'.flatpak',mimeType:'application/vnd.flatpak',
    authority:'node-native',platform:'linux',architectures:Object.freeze(['x64','arm64']),
    tools:Object.freeze(['flatpak','ostree']),bundledSystemLibraries:false})
});

// GNOME 50 carries GTK 3, GTK 4 and a new enough freedesktop libc/C++ ABI for
// the Ubuntu 24.04 AOT payload. A versioned runtime is a dependency, not part of
// the application bundle. Exporting a bundle does not install or download it.
export const LINUX_FLATPAK_RUNTIME=Object.freeze({
  name:'org.gnome.Platform',version:'50',
  repository:'https://dl.flathub.org/repo/flathub.flatpakrepo'
});
export const LINUX_FLATPAK_DEFAULT_PERMISSIONS=Object.freeze([
  'share=ipc','socket=wayland','socket=fallback-x11','socket=cups','device=dri'
]);
