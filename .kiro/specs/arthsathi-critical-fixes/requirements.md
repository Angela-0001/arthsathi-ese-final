# Requirements Document

## Introduction

This requirements document specifies the functional and non-functional requirements for resolving six critical issues in the ArthSathi application: authentication and API configuration issues, broken document analysis pipeline, profile-ignorant recommendations across all platforms (web, Telegram, WhatsApp), incomplete multilingual support, missing financial roadmap feature, and excessive hardcoding throughout the system. These requirements are derived from the approved design document and will guide the implementation to ensure consistent, reliable, and user-friendly financial assistance across all communication channels.

## Glossary

- **API_Gateway**: The Express.js backend server that handles all API requests from web, Telegram, and WhatsApp clients
- **Config_Manager**: The frontend component responsible for dynamic API URL resolution based on environment detection
- **Profile_Service**: Backend service that manages user profile data and provides it to all recommendation engines
- **Recommendation_Adapter**: Platform-agnostic service that provides consistent scheme and insurance recommendations across all channels
- **Document_Analyzer**: Service that performs OCR, text extraction, and risk analysis on uploaded financial documents
- **Translation_Manager**: Service that handles multilingual content delivery across all UI elements
- **Roadmap_Generator**: Service that creates personalized financial planning timelines based on user profile and goals
- **Groq_Service**: External AI service for intelligent scheme recommendation filtering
- **ML_Engine**: Python-based machine learning service for advanced recommendation logic
- **OCR_Engine**: Tesseract-based optical character recognition service
- **User_Profile**: Complete user information including demographics, financial status, and goals
- **Scheme**: Government welfare program with eligibility criteria and benefits
- **Insurance_Product**: Insurance policy offering with premium, coverage, and eligibility details
- **Risk_Flag**: Identified problematic clause or condition in an analyzed document
- **Complete_Profile**: User profile containing all mandatory fields (age, gender, state, income, occupation, caste_category, goals)
- **Platform**: Communication channel (Web, Telegram, or WhatsApp)

## Requirements

### Requirement 1: Dynamic API Configuration

**User Story:** As a developer, I want the frontend to automatically detect and use the correct backend API URL, so that the application works seamlessly in local, LAN, and production environments without manual configuration changes.

#### Acceptance Criteria

1. WHEN the frontend application loads on localhost (127.0.0.1 or localhost), THE Config_Manager SHALL resolve the API URL to `http://localhost:3001`
2. WHEN the frontend application loads on a LAN IP address (192.168.x.x or 10.x.x.x), THE Config_Manager SHALL resolve the API URL to `http://<LAN_IP>:3001`
3. WHEN the frontend application loads on a production domain, THE Config_Manager SHALL resolve the API URL from the NEXT_PUBLIC_API_URL environment variable
4. WHEN server-side rendering occurs, THE Config_Manager SHALL resolve the API URL to `http://localhost:3001` regardless of client environment
5. THE Config_Manager SHALL cache the resolved API URL for the duration of the application session
6. WHEN the API URL is resolved, THE Config_Manager SHALL validate that the URL is a valid HTTP or HTTPS URL
7. IF the API URL resolution fails, THEN THE Config_Manager SHALL throw a ConfigurationError with a descriptive message

### Requirement 2: Centralized User Profile Management

**User Story:** As a backend developer, I want a single Profile_Service that all other services use to fetch user data, so that profile logic is consistent and recommendations always use accurate user information.

#### Acceptance Criteria

1. THE Profile_Service SHALL provide a fetchUserProfile(userId) function that returns a complete User_Profile object
2. WHEN fetchUserProfile is called with a valid userId, THE Profile_Service SHALL query the users and financial_profiles tables in a single database operation
3. WHEN fetchUserProfile is called with an invalid or non-existent userId, THE Profile_Service SHALL throw a ProfileNotFoundError
4. THE Profile_Service SHALL cache fetched profiles for 5 minutes using the key pattern `profile:{userId}`
5. WHEN a cached profile exists and is not expired, THE Profile_Service SHALL return the cached profile without database query
6. THE Profile_Service SHALL provide an isProfileComplete(profile) function that validates presence of mandatory fields
7. IF a profile is missing mandatory fields, THEN isProfileComplete SHALL return false with an array of missing field names
8. WHEN a profile is updated via updateProfile function, THE Profile_Service SHALL invalidate the cached profile immediately

### Requirement 3: Profile-Based Recommendations Across All Platforms

**User Story:** As a user, I want to receive scheme and insurance recommendations that match my actual profile details, so that I only see programs I'm eligible for regardless of whether I access via web, Telegram, or WhatsApp.

#### Acceptance Criteria

1. THE Recommendation_Adapter SHALL accept only userId as input (not hardcoded test IDs)
2. WHEN getSchemes is called with a userId, THE Recommendation_Adapter SHALL fetch the user profile via Profile_Service before generating recommendations
3. WHEN generating scheme recommendations, THE Recommendation_Adapter SHALL filter schemes based on user's age, income, caste_category, state, occupation, and disability_status
4. WHEN generating insurance recommendations, THE Recommendation_Adapter SHALL filter insurance products based on user's age, income, and life stage
5. IF the user profile is incomplete, THEN THE Recommendation_Adapter SHALL return a 400 error with specific missing field names
6. THE Recommendation_Adapter SHALL attempt Groq_Service first, fall back to ML_Engine if Groq fails, and fall back to database filtering if ML_Engine fails
7. WHEN any recommendation engine returns results, THE Recommendation_Adapter SHALL rank results by eligibility match score (highest first)
8. THE Web API SHALL call Recommendation_Adapter with the authenticated user's ID from the JWT token
9. THE Telegram Bot SHALL call Recommendation_Adapter with the user's ID retrieved from the telegram_user_id mapping
10. THE WhatsApp Bot SHALL call Recommendation_Adapter with the user's ID retrieved from the whatsapp_user_id mapping
11. FOR ALL platforms, the Recommendation_Adapter SHALL return identical scheme lists for the same user profile
12. THE Recommendation_Adapter SHALL log recommendation requests with timestamp, userId, platform, and result count for analytics

### Requirement 4: Robust Document Analysis Pipeline

**User Story:** As a user, I want to upload financial documents and receive accurate risk analysis in my preferred language, so that I can understand problematic clauses before signing agreements.

#### Acceptance Criteria

1. WHEN a user uploads a document, THE API_Gateway SHALL validate that the file type is image (JPEG, PNG, WEBP) or PDF
2. WHEN a user uploads a document, THE API_Gateway SHALL validate that the file size is ≤ 10MB
3. IF the file type is invalid, THEN THE API_Gateway SHALL return a 400 error with message "Only images and PDFs are supported"
4. IF the file size exceeds 10MB, THEN THE API_Gateway SHALL return a 400 error with message "File size must be under 10MB"
5. WHEN a valid document is uploaded, THE Document_Analyzer SHALL extract text using the OCR_Engine with the specified language parameter
6. WHEN OCR extraction completes, THE Document_Analyzer SHALL calculate a confidence score (0-100)
7. IF the OCR confidence score is < 60, THEN THE Document_Analyzer SHALL return a 400 error with message "Image quality too low. Please provide a clearer photo"
8. WHEN OCR succeeds with confidence ≥ 60, THE Document_Analyzer SHALL analyze the extracted text for risk patterns
9. THE Document_Analyzer SHALL identify risk flags by matching against predefined patterns (high interest rates, penalty clauses, hidden fees, short repayment periods)
10. WHEN risk flags are identified, THE Document_Analyzer SHALL assign severity levels (low, medium, high) based on pattern rules
11. IF the Groq_Service is available, THEN THE Document_Analyzer SHALL use it to generate a natural language summary of the document
12. THE Document_Analyzer SHALL translate all risk flag explanations and the summary into the user's requested language
13. THE Document_Analyzer SHALL calculate an overall risk level based on the count and severity of individual risk flags
14. WHEN analysis completes, THE Document_Analyzer SHALL store the results in the documents table with a generated document_id
15. THE Document_Analyzer SHALL return an AnalysisResult containing document_id, summary, risk_flags array, ocr_confidence, and risk_level

### Requirement 5: Complete Multilingual Support

**User Story:** As a user who speaks Hindi or Marathi, I want the entire application interface to be available in my language, so that I can use the platform without language barriers.

#### Acceptance Criteria

1. THE Translation_Manager SHALL support three languages: English (en), Hindi (hi), and Marathi (mr)
2. THE Translation_Manager SHALL organize translations into namespaces: common, schemes, insurance, dashboard, errors, roadmap, documents
3. WHEN a translation key is requested with a language code, THE Translation_Manager SHALL return the translated string for that language
4. IF a translation key does not exist for the requested language, THEN THE Translation_Manager SHALL fall back to English
5. THE Frontend SHALL load translation namespaces on demand (lazy loading) to optimize initial page load
6. WHEN the user changes language preference, THE Frontend SHALL reload all visible UI elements with the new language
7. THE Frontend SHALL persist the user's language preference in localStorage and user profile
8. THE Backend SHALL translate dynamic content (scheme names, insurance descriptions) returned in API responses based on the Accept-Language header
9. THE Telegram Bot SHALL detect user language from Telegram settings and use that language for all messages
10. THE WhatsApp Bot SHALL detect user language from the first message and store it in the user profile
11. FOR ALL platforms, error messages SHALL be translated to the user's preferred language
12. THE Translation_Manager SHALL cache loaded translation namespaces for 1 hour to optimize performance

### Requirement 6: Financial Roadmap Generation

**User Story:** As a user, I want a personalized financial plan showing which schemes to apply for and when, so that I can systematically improve my financial situation and achieve my goals.

#### Acceptance Criteria

1. THE Roadmap_Generator SHALL provide a generate(userId) function that creates a complete FinancialRoadmap
2. WHEN generate is called, THE Roadmap_Generator SHALL fetch the user profile via Profile_Service
3. IF the user profile lacks monthly_income data, THEN THE Roadmap_Generator SHALL return a 400 error with message "Income data required for roadmap generation"
4. THE Roadmap_Generator SHALL calculate the user's current financial state including monthly_income, monthly_expenses, total_debts, total_savings, and net_worth
5. THE Roadmap_Generator SHALL parse the user's goals from the profile goals field
6. THE Roadmap_Generator SHALL fetch all schemes the user is eligible for via Recommendation_Adapter
7. THE Roadmap_Generator SHALL fetch all insurance products the user is eligible for via Recommendation_Adapter
8. THE Roadmap_Generator SHALL generate immediate actions (0-3 months) including high-benefit scheme applications and essential insurance purchases
9. THE Roadmap_Generator SHALL generate short-term actions (3-12 months) including emergency fund creation and debt reduction
10. THE Roadmap_Generator SHALL generate long-term actions (1+ years) including goal-specific savings plans
11. FOR EACH generated action, THE Roadmap_Generator SHALL calculate estimated_benefit, effort_level, and deadline
12. THE Roadmap_Generator SHALL create a timeline by combining all action deadlines and goal deadlines
13. THE Roadmap_Generator SHALL sort timeline events chronologically
14. WHEN the roadmap is complete, THE Roadmap_Generator SHALL return a FinancialRoadmap object with current_state, goals, recommendations, and timeline
15. THE Roadmap_Generator SHALL ensure all recommended schemes and insurance in the roadmap are ones the user is actually eligible for

### Requirement 7: Configuration Externalization

**User Story:** As a developer and system administrator, I want all configuration values to come from environment variables or database, so that the application can be deployed to different environments without code changes.

#### Acceptance Criteria

1. THE Backend SHALL load all API keys (GROQ_API_KEY, DATABASE_URL, JWT_SECRET) from environment variables only
2. THE Backend SHALL never contain hardcoded API keys, database credentials, or user IDs in source code
3. THE Frontend SHALL load the API URL from NEXT_PUBLIC_API_URL environment variable for production builds
4. THE Backend SHALL load bot tokens (TELEGRAM_BOT_TOKEN, WHATSAPP_API_KEY) from environment variables
5. THE Backend SHALL store feature flags in the database configurations table, not in code
6. WHEN a configuration value is missing, THE application SHALL fail to start with a clear error message indicating which variable is missing
7. THE Backend SHALL load rate limiting thresholds from environment variables with sensible defaults

### Requirement 8: Error Handling and Fallback Mechanisms

**User Story:** As a user, I want the application to handle errors gracefully and provide helpful feedback, so that temporary service issues don't prevent me from accessing basic functionality.

#### Acceptance Criteria

1. WHEN the Groq_Service fails or returns an error, THE Recommendation_Adapter SHALL fall back to the ML_Engine without user-visible errors
2. WHEN the ML_Engine fails or is unavailable, THE Recommendation_Adapter SHALL fall back to database filtering
3. WHEN the OCR_Engine fails, THE Document_Analyzer SHALL return a 500 error with message "Document processing failed. Please try again"
4. WHEN the Translation_Manager cannot load translations, THE Frontend SHALL display English content with a warning message
5. WHEN the database connection is lost, THE API_Gateway SHALL return a 503 error with message "Service temporarily unavailable"
6. WHEN API requests time out (>30 seconds), THE Frontend SHALL display a timeout error with a retry button
7. IF profile fetching fails, THE Frontend SHALL display cached profile data if available, otherwise show an error state
8. THE API_Gateway SHALL implement exponential backoff retry for database connection failures (3 attempts: 1s, 2s, 4s delays)
9. WHEN the backend is unreachable, THE Frontend SHALL show an offline indicator and allow viewing cached data

### Requirement 9: Performance Optimization

**User Story:** As a user, I want fast response times when viewing recommendations and analyzing documents, so that the application feels responsive and efficient.

#### Acceptance Criteria

1. THE Profile_Service SHALL cache fetched profiles with a 5-minute TTL
2. THE Recommendation_Adapter SHALL cache scheme lists with a 15-minute TTL
3. THE Recommendation_Adapter SHALL cache user-specific recommendations with a 1-minute TTL
4. THE Translation_Manager SHALL cache loaded translation namespaces with a 1-hour TTL
5. THE Backend SHALL use database connection pooling with minimum 5 and maximum 20 connections
6. THE Backend SHALL create composite database indexes on schemes table for age, income, and state columns
7. WHEN recommendations are requested, THE query execution time SHALL be ≤ 500ms for cached results
8. WHEN recommendations are requested, THE query execution time SHALL be ≤ 2 seconds for uncached results
9. WHEN documents are analyzed, THE total processing time SHALL be ≤ 10 seconds for images ≤ 5MB
10. THE Frontend SHALL implement code splitting to load recommendation and document analysis components on demand
11. THE Frontend SHALL compress uploaded images to ≤ 2MB before sending to backend

### Requirement 10: Security and Data Protection

**User Story:** As a user, I want my personal financial information to be protected, so that sensitive data like income, Aadhaar, and document details remain confidential.

#### Acceptance Criteria

1. THE API_Gateway SHALL verify JWT tokens on all authenticated endpoints
2. THE API_Gateway SHALL extract user_id from the JWT token, never trusting client-provided user_id values
3. THE API_Gateway SHALL rate limit requests to 100 per hour per user to prevent abuse
4. THE Backend SHALL store Aadhaar numbers as SHA-256 hashes only, never in plaintext
5. THE Backend SHALL redact sensitive fields (aadhaar, income, financial_profiles) from application logs
6. THE Backend SHALL validate file uploads to only accept image/* and application/pdf MIME types
7. THE Backend SHALL generate random filenames for uploaded documents to prevent guessing
8. THE Backend SHALL store uploaded documents outside the web root directory
9. THE Backend SHALL implement CORS with whitelist of allowed origins
10. THE Telegram Bot SHALL validate Telegram user ID signatures to prevent impersonation
11. THE WhatsApp Bot SHALL verify webhook signatures from WhatsApp API
12. WHEN users link Telegram or WhatsApp to their account, THE system SHALL require a secure verification code

### Requirement 11: Platform-Specific Bot Integration

**User Story:** As a user on Telegram or WhatsApp, I want the bots to provide the same personalized recommendations as the web app, so that I can access my financial assistance through my preferred communication channel.

#### Acceptance Criteria

1. THE Telegram Bot SHALL map telegram_user_id to application user_id via the telegram_users table
2. THE WhatsApp Bot SHALL map whatsapp_user_id to application user_id via the whatsapp_users table
3. WHEN a new Telegram user interacts with the bot, THE system SHALL create a new user record and store the telegram_user_id mapping
4. WHEN a Telegram user requests schemes, THE bot SHALL call the Recommendation_Adapter with the mapped user_id
5. WHEN a WhatsApp user requests schemes, THE bot SHALL call the Recommendation_Adapter with the mapped user_id
6. THE Telegram Bot SHALL format recommendation results as Telegram messages with inline buttons
7. THE WhatsApp Bot SHALL format recommendation results as WhatsApp messages with interactive lists
8. THE Telegram Bot SHALL support commands: /start, /schemes, /insurance, /profile, /roadmap, /language
9. THE WhatsApp Bot SHALL recognize natural language queries for schemes, insurance, and roadmap
10. WHEN users change language preference via bot, THE system SHALL update the user profile in the database
11. THE Bots SHALL rate limit commands to 10 per minute per user

### Requirement 12: Monitoring and Observability

**User Story:** As a system administrator, I want visibility into application health, errors, and usage patterns, so that I can proactively identify and resolve issues.

#### Acceptance Criteria

1. THE API_Gateway SHALL log all incoming requests with timestamp, endpoint, user_id, and response status
2. THE API_Gateway SHALL log all errors with stack traces to a centralized logging service
3. THE Recommendation_Adapter SHALL log recommendation sources (groq, engine, fallback) and result counts
4. THE Document_Analyzer SHALL log OCR confidence scores and processing times
5. THE Backend SHALL expose a /health endpoint that returns 200 OK when all dependencies are healthy
6. THE /health endpoint SHALL check database connectivity, Groq_Service availability, and ML_Engine status
7. WHEN the Groq_Service fails, THE system SHALL increment a groq_failure_count metric
8. WHEN the ML_Engine is unavailable, THE system SHALL increment an ml_engine_unavailable metric
9. THE Backend SHALL track API response times and log warnings when endpoints exceed 2 seconds
10. THE Frontend SHALL report JavaScript errors to a monitoring service (e.g., Sentry)

### Requirement 13: Data Consistency and Validation

**User Story:** As a system, I want to ensure data integrity across all services, so that invalid or incomplete data doesn't cause recommendation errors or user confusion.

#### Acceptance Criteria

1. THE Profile_Service SHALL validate that age is between 0 and 120
2. THE Profile_Service SHALL validate that monthly_income and annual_income are non-negative
3. THE Profile_Service SHALL validate that caste_category is one of: general, obc, sc, st, nt, vjnt
4. THE Profile_Service SHALL validate that preferred_language is one of: en, hi, mr
5. THE Profile_Service SHALL validate that state is a valid Indian state or union territory
6. WHEN profile validation fails, THE Profile_Service SHALL return a 400 error with specific validation errors for each invalid field
7. THE Recommendation_Adapter SHALL verify that all returned schemes have valid eligibility criteria
8. THE Document_Analyzer SHALL verify that uploaded files are not corrupted before processing
9. THE Roadmap_Generator SHALL verify that goal deadlines are in the future
10. THE API_Gateway SHALL sanitize all string inputs to prevent SQL injection and XSS attacks

### Requirement 14: Backward Compatibility and Migration

**User Story:** As an existing user, I want my profile and historical data to remain accessible after system updates, so that I don't lose my progress or have to re-enter information.

#### Acceptance Criteria

1. WHEN the Config_Manager is deployed, THE existing Frontend SHALL continue to function with the backend
2. WHEN the Profile_Service is deployed, THE system SHALL migrate existing user profile queries to use the new service
3. THE Backend SHALL maintain existing API endpoint paths for web, Telegram, and WhatsApp integrations
4. THE Backend SHALL support both old (hardcoded) and new (profile-based) recommendation logic during a transition period
5. THE Database migration scripts SHALL preserve all existing user data
6. WHEN new translation keys are added, THE system SHALL fall back to English for missing translations
7. THE Financial roadmap feature SHALL be accessible via a new /roadmap endpoint without breaking existing endpoints

### Requirement 15: Testing and Quality Assurance

**User Story:** As a developer, I want comprehensive test coverage, so that changes don't introduce regressions and the system remains reliable.

#### Acceptance Criteria

1. THE Profile_Service SHALL have unit tests covering fetchUserProfile, updateProfile, and isProfileComplete functions
2. THE Config_Manager SHALL have unit tests for API URL resolution in localhost, LAN, and production environments
3. THE Recommendation_Adapter SHALL have integration tests verifying that web, Telegram, and WhatsApp all return identical results for the same user
4. THE Document_Analyzer SHALL have unit tests for OCR extraction, risk pattern matching, and translation
5. THE Roadmap_Generator SHALL have unit tests for financial state calculation and timeline generation
6. THE Backend SHALL have property-based tests verifying that all recommendations match user eligibility criteria
7. THE Frontend SHALL have end-to-end tests covering language switching, scheme viewing, and document upload flows
8. THE overall test coverage SHALL be ≥ 80% for core services (Profile_Service, Recommendation_Adapter, Document_Analyzer)con
