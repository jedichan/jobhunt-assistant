# Preliminary Job Pool Workflow

Read the current user's application_rules.md, candidate_profile.json and resume_routing.md for screening preferences. Do not invent their cities, recruiting cohort, graduation date, industries or resume variants.

Write discovered leads to dashboard/preliminary_job_pool.csv. Screening must not log in, open application flows, upload material, submit, modify job_pool.csv or create application_log.csv entries.

Prefer official employer postings. Verify the employer, location, live opening, responsibilities, mandatory qualifications and eligibility window. A third-party listing can help discovery, but retain official evidence before treating an opening as verified. Unknown eligibility remains Needs review; a clear mandatory mismatch should be skipped with a reason.

Deduplicate against both pools by employer, role, location and official URL, checking ATS job IDs as well. Use stable lead_id values. New leads begin as Preliminary or Needs review with priority P1/P2/P3 and a resume variant defined by the user's own routing.

Keep official URL, dates when known, eligibility evidence, employer type, fit summary and blockers. Use the existing CSV header and leave user_decision/promoted_at blank until the user makes a decision.

Only promote after the user gives an explicit lead_id and asks to proceed. Deduplicate before mapping the record to job_pool.csv. Preserve source history and existing application states. Promotion does not prove submission and does not itself authorize filling or uploading.
