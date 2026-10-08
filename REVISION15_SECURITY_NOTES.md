# Revision 15 staging dependency note

- exceljs 4.4.0 currently resolves uuid 8.3.2.
- npm audit reports the associated UUID advisory as moderate.
- Do not run `npm audit fix --force`; npm currently proposes a
  breaking ExcelJS downgrade.
- This dependency is permitted for staging validation only.
- Re-evaluate/upgrade/replace the XLSX dependency before the
  production-readiness gate if upstream remains unresolved.
- File uploads are currently limited to 5 MiB and 50 parsed rows.
