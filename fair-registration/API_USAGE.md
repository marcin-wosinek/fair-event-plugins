# Fair Registration API Usage

The Fair Registration plugin provides a REST API for managing registrations.

## Endpoints

### Create Registration
**POST** `/wp-json/fair-registration/v1/registrations`

Creates a new registration entry.

#### Request Body
```json
{
  "form_id": 123,
  "url": "https://example.com/event-registration",
  "registration_data": {
    "name": "John Doe",
    "email": "john.doe@example.com",
    "phone": "+1234567890",
    "custom_field": "custom_value"
  }
}
```

#### Response (201 Created)
```json
{
  "id": 1,
  "form_id": 123,
  "user_id": null,
  "url": "https://example.com/event-registration",
  "registration_data": {
    "name": "John Doe",
    "email": "john.doe@example.com",
    "phone": "+1234567890",
    "custom_field": "custom_value"
  },
  "created": "2024-01-15 10:30:00",
  "modified": "2024-01-15 10:30:00"
}
```

### Get Registrations
**GET** `/wp-json/fair-registration/v1/registrations`

Retrieves registrations (requires `manage_options` capability).

#### Query Parameters
- `form_id` (optional): Filter by form ID
- `page` (optional): Page number (default: 1)
- `per_page` (optional): Results per page (default: 10, max: 100)

#### Example URLs
- `/wp-json/fair-registration/v1/registrations` - All registrations
- `/wp-json/fair-registration/v1/registrations?form_id=123` - Registrations for form 123
- `/wp-json/fair-registration/v1/registrations?page=2&per_page=20` - Page 2, 20 per page

### Get Single Registration
**GET** `/wp-json/fair-registration/v1/registrations/{id}`

Retrieves a single registration by ID (requires `manage_options` capability).

## JavaScript Example

```javascript
// Create a new registration
async function submitRegistration(formId, formData) {
  const response = await fetch('/wp-json/fair-registration/v1/registrations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      form_id: formId,
      url: window.location.href,
      registration_data: formData
    })
  });

  if (response.ok) {
    const registration = await response.json();
    console.log('Registration created:', registration);
    return registration;
  } else {
    const error = await response.json();
    console.error('Registration failed:', error);
    throw new Error(error.message);
  }
}

// Example usage
const registrationData = {
  name: 'Jane Smith',
  email: 'jane.smith@example.com',
  phone: '+1987654321'
};

submitRegistration(123, registrationData)
  .then(registration => {
    alert('Registration successful!');
  })
  .catch(error => {
    alert('Registration failed: ' + error.message);
  });
```

## cURL Examples

### Create Registration
```bash
curl -X POST "https://yoursite.com/wp-json/fair-registration/v1/registrations" \
  -H "Content-Type: application/json" \
  -d '{
    "form_id": 123,
    "url": "https://yoursite.com/event-registration",
    "registration_data": {
      "name": "John Doe",
      "email": "john.doe@example.com"
    }
  }'
```

### Get Registrations (requires authentication)
```bash
curl -X GET "https://yoursite.com/wp-json/fair-registration/v1/registrations?form_id=123" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Error Responses

### 400 Bad Request
```json
{
  "code": "invalid_form_id",
  "message": "The specified form ID does not exist or does not contain a registration form.",
  "data": {
    "status": 400
  }
}
```

### 403 Forbidden
```json
{
  "code": "rest_forbidden",
  "message": "Sorry, you are not allowed to do that.",
  "data": {
    "status": 403
  }
}
```

### 500 Internal Server Error
```json
{
  "code": "registration_creation_failed",
  "message": "Failed to create registration.",
  "data": {
    "status": 500
  }
}
```

## Security Notes

- The `POST` endpoint is public to allow form submissions from anonymous users
- The `GET` endpoints require `manage_options` capability (admin access)
- In production, consider adding nonce verification for form submissions
- The API validates that the specified `form_id` exists and contains registration blocks
- All input is sanitized and validated before database storage