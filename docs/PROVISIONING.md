# Provisioning

Development: `idf.py -B build-dev -p COMx flash monitor` after building with your pins. Dev images are not secure.

Production (Phase 7, not implemented yet): Secure Boot v2 and flash encryption (Release) burn **irreversible**
eFuses. No script in this repository does that. Each such step will be listed here as
`[IRREVERSIBLE – operator confirms]`, to be run manually, first on a sacrificial board. `tools/provision_check.py`
will only read eFuse state.
