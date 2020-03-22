# Offie - Home Office Nudger

## Technical View of Flow for Backend

### Registration

1. User clicks get started
2. User answers onboarding questions
3. User is asked for email and password which is sent to backend:
```
POST /register
data:
{
  "usermail": "john.doe@offie.guru",
  "password": "verysafepassword"
}
```
4. User is displayed with "connect to Slack" Link
5. Goes to Slack, authenticates Offie, Slack referrs back with auth_code
6. Offie redirects to user home, sends auth_code to backend:
```
POST /slack
{
  "usermail": "john.doe@offie.guru",
  "slackAuthCode": "auth_code_1234"
}
```
7. Backend exchanges the auth_code for an access_token and persists access_token. It is now able to communicate with the user via slack.
8. User moves freely between tasks (status) and topics (themes) which requires the following endpoint:
```
GET /tasks/:encoded_usermail

response:
{
  "taskId": 12,
  "usermail": "john.doe@offie.guru",
  "assignedAt": 150992475,
  "resolvedAt": null,
  "focusArea": "Socializing im Homeoffice"
  "title": "Werde zum digitalen Kaffeeklatschprofi",
  "description": "Dir fehlen die gewohnten informellen sozialen Austausche? Dir fällt die Decke auf den Kopf? Trinke einen virtuellen Kaffee mit deinen Kollegen."
}
```
9. Finally, a user might complete or reject a task:
```
GET /task/:taskId/reject

GET /task/:taskId/complete
```

Stats and other stuff remains tbd.