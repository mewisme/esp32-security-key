import pytest
from conftest import *  # noqa
from test_multikey_uv import setpin, PERM_MC, raw_verify


def test_probe(emu, session, reopen):
    setpin(session)
    _, att = session.mc(auth_perm=PERM_MC)
    cred = att.auth_data.credential_data
    session.close()
    emu.restart()
    s2 = reopen()
    cdh, asr = s2.ga(cred.credential_id)
    print("GA OK", asr.auth_data.flags, asr.credential)
    import shutil
    shutil.copy(emu.log.name, "/tmp/probe.log")
    print(open(emu.log.name, "rb").read()[-3000:].decode(errors="replace"))
