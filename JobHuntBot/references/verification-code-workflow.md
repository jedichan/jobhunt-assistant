# Login Verification Workflow

This is an assisted workflow, not unattended credential automation.

1. When a login page shows an image CAPTCHA, pause before solving it and ask for action-time confirmation naming the site and purpose. After confirmation, inspect the visible CAPTCHA and enter the result once. If it is ambiguous or protected by a human-verification/anti-bot challenge, hand the browser back to the user.
2. When the site requests an SMS code, pause before opening the macOS Messages app or transmitting the code. Ask for action-time confirmation naming the destination site and the purpose. After confirmation, read only the newest matching message, enter the one-time code once, and do not save the code in project files, logs, memory, or automation prompts.
3. Never use a code from an unrelated sender, an old message, or a different account. Do not forward, send, or expose the message contents.
4. Do not make CAPTCHA or SMS handling available to the daily job-discovery automation. Discovery remains read-only and must not log in. Application runs may use this workflow only interactively with the user present.
5. Before a final job-application submission, show the company, role, location, selected resume, and key answers and wait for explicit user confirmation.
