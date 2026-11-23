MultiKeys {title} v{version}
Board: ESP32-S3 N16R8 (16 MB flash, native USB, BOOT button on GPIO0 used as the touch button, no LED)

EXPERIMENTAL DEVELOPMENT FIRMWARE - not suitable for protecting important accounts.
It uses a development USB identity (VID:PID {vid}:{pid}) and a development AAGUID, has no Secure Boot and no flash
encryption, and its key material can be read by anyone with physical access to the board.

Easiest way to install: open https://multikeys.mewis.me in desktop Chrome or Edge and follow the steps.

Manual install (advanced; needs Python and esptool):
  1. Put the board in download mode: unplug it, hold BOOT, plug the USB/OTG connector in, release BOOT.
  2. From this folder run (replace PORT with the serial port, e.g. COM5 or /dev/ttyACM0):
       {command}

This writes only the bootloader, the partition table and the app. It never erases the whole chip; your stored
credentials (the "part0" area) are left in place. Never add an erase option to the command above.

Files:
  bootloader.bin, partition-table.bin, {app_file}   the three images and their offsets above
  firmware.json   build description (offsets, sizes, SHA-256, partition layout)
  SHA256SUMS      checksums of the three images (sha256sum -c SHA256SUMS)
  LICENSE         AGPL-3.0-or-later
  NOTICE.txt      third-party components and where to get the corresponding source
