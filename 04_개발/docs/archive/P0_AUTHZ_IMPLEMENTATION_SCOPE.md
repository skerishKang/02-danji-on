# P0 AuthZ Implementation Scope

This lane owns only Household/Resident authorization and PADIEM operator authorization required before Community C2/C3.

Included:
- migrations 009–012
- authorization-v2 guards
- synthetic authorization tests
- migration sandbox verification

Excluded:
- Community tables/APIs
- production migration apply
- production deployment
- provider final selection
- full rewrite of legacy admin APIs
