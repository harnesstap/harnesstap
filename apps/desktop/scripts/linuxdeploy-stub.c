/* ELF stub placed at ~/.cache/tauri/linuxdeploy-${ARCH}.AppImage.
 *
 * tauri-bundler may `dd` three zero bytes at offset 8 of that path to hide
 * AppImage magic from binfmt. A shell shebang sits in those bytes and would
 * be corrupted; EI_OSABI/EI_ABIVERSION padding in a normal ELF is already
 * zero, so the dd is a no-op.
 */
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

#ifndef WRAP_SH
#error "compile with -DWRAP_SH=\\\"/path/to/linuxdeploy-wrap.sh\\\""
#endif

int main(int argc, char **argv) {
  (void)argc;
  if (argv[0] && argv[0][0] != '\0' && getenv("LINUXDEPLOY_STUB") == NULL) {
    setenv("LINUXDEPLOY_STUB", argv[0], 0);
  }
  execv(WRAP_SH, argv);
  perror("linuxdeploy-stub: execv " WRAP_SH);
  return 127;
}
