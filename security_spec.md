# Security Spec

1. Data Invariants:
- A NewsPost can only be created by an authenticated user whose email is `gashaw7abi@gmail.com` and who is email verified.
- A NewsPost must have a valid structure: headline, description, publishedAt, authorEmail, published.
- Anyone can read a NewsPost if its `published` field is true.

2. The Dirty Dozen Payloads:
- Payload 1: Missing headline field in NewsPost create.
- Payload 2: authorEmail doesn't match request.auth.token.email in NewsPost update.
- Payload 3: Non-admin trying to create in customNews collection.
- Payload 4: Invalid Types (number instead of string) for headline.
- Payload 5: Payload exceeds description character limit (e.g., 50k characters).
- Payload 6: Injecting 'isAdmin: true' field in user profile.
- Payload 7: Accessing PII outside of isOwner/isAdmin.
- Payload 8: Attempting to delete a document without valid ID.
- Payload 9: Attempting to create a Session for someone else.
- Payload 10: Modifying fcmTokens without appropriate role.
- Payload 11: Attempting to update a 'finished' or 'completed' status/field.
- Payload 12: Payload containing "Ghost Field" (e.g., invalid system field in customNews).
