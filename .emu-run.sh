#!/bin/bash
cd /mnt/i/Project/esp32/security-key
tr -d "\r" < tools/run_emulation_tests.sh > $HOME/run_emu.sh
sed -i "s#^ROOT=.*#ROOT=/mnt/i/Project/esp32/security-key#" $HOME/run_emu.sh
export EMU_WORK=$HOME/mkemu
bash $HOME/run_emu.sh "$@" 2>&1
