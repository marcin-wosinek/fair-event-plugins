<?php
/**
 * Questionnaire Service
 *
 * Shared logic for handling `fair-form-*` question answers submitted through
 * either the Fair Form block or the Event Signup block: parsing, sanitizing,
 * file-upload handling, and persistence into the questionnaire submission /
 * answer tables.
 *
 * @package FairForm
 */

namespace FairForm\Services;

use FairForm\Database\QuestionnaireSubmissionRepository;
use FairForm\Database\QuestionnaireAnswerRepository;
use FairForm\Models\QuestionnaireSubmission;
use FairEventsShared\Helpers\SafeUrlFetcher;
use FairEventsShared\Helpers\PageMetadataParser;
use WP_REST_Request;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * Service for processing and persisting questionnaire answers.
 */
class QuestionnaireService {

	/**
	 * Allowed MIME types for file uploads.
	 *
	 * @var array
	 */
	const ALLOWED_FILE_TYPES = array(
		'image/jpeg',
		'image/png',
		'image/gif',
		'image/webp',
		'application/pdf',
		'application/msword',
		'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
	);

	/**
	 * Maximum file size in bytes (20 MB).
	 */
	const MAX_FILE_SIZE = 20 * 1024 * 1024;

	/**
	 * Valid question types.
	 *
	 * @var array
	 */
	const VALID_TYPES = array( 'radio', 'checkbox', 'short_text', 'long_text', 'select', 'number', 'date', 'datetime', 'multiselect', 'file_upload', 'phone', 'email', 'url' );

	/**
	 * HTML `pattern` attribute value for the phone question's `<input>`.
	 *
	 * Interleaved form of the normalized rule below: separators (spaces,
	 * dots, parens, hyphens) may appear anywhere after the leading `+`,
	 * since the `pattern` attribute can't post-process the typed value.
	 *
	 * @var string
	 */
	const PHONE_HTML_PATTERN = '[\s\.\(\)\-]*\+[\s\.\(\)\-]*[1-9](?:[\s\.\(\)\-]*[0-9]){6,14}[\s\.\(\)\-]*';

	/**
	 * Regex a normalized phone value (separators already stripped) must match.
	 *
	 * @var string
	 */
	const PHONE_NORMALIZED_PATTERN = '/^\+[1-9][0-9]{6,14}$/';

	/**
	 * Example phone number per site timezone for the phone question's
	 * placeholder, one entry per country in ticket #1269's table. Mirrored
	 * by the JS twin `PHONE_PLACEHOLDER_BY_TIMEZONE` in
	 * `fair-events-shared/src/phone-placeholder.js` — keep both maps in sync.
	 *
	 * @var array
	 */
	const PHONE_PLACEHOLDERS = array(
		'Europe/Madrid'       => '+34 612 34 56 78',
		'Europe/Berlin'       => '+49 170 1234567',
		'Europe/Paris'        => '+33 6 12 34 56 78',
		'Europe/Rome'         => '+39 312 345 6789',
		'Europe/Amsterdam'    => '+31 6 12345678',
		'Europe/Brussels'     => '+32 470 12 34 56',
		'Europe/Zurich'       => '+41 79 123 45 67',
		'Europe/Warsaw'       => '+48 512 345 678',
		'Europe/Lisbon'       => '+351 912 345 678',
		'Europe/London'       => '+44 7700 900123',
		'America/New_York'    => '+1 201 555 0123',
		'America/Chicago'     => '+1 201 555 0123',
		'America/Denver'      => '+1 201 555 0123',
		'America/Los_Angeles' => '+1 201 555 0123',
	);

	/**
	 * Fallback example for timezones outside the mapped set, and for sites
	 * configured with a raw UTC offset instead of a city.
	 *
	 * @var string
	 */
	const PHONE_PLACEHOLDER_FALLBACK = '+49 170 1234567';

	/**
	 * Resolve the example placeholder for a given (or the site's) timezone.
	 *
	 * Deliberately reads the raw `timezone_string` option rather than
	 * `wp_timezone_string()`, which returns a `+02:00`-style offset on sites
	 * configured with a raw UTC offset instead of a city — the same raw
	 * value `@wordpress/date`'s `getSettings().timezone.string` sees in JS,
	 * which is what gives editor/frontend parity.
	 *
	 * @param string|null $timezone_string Timezone string, or null to read the site's.
	 * @return string The mapped example, or the fallback.
	 */
	public static function phone_placeholder( $timezone_string = null ) {
		if ( null === $timezone_string ) {
			$timezone_string = get_option( 'timezone_string' );
		}

		return self::PHONE_PLACEHOLDERS[ $timezone_string ] ?? self::PHONE_PLACEHOLDER_FALLBACK;
	}

	/**
	 * Questionnaire submission repository instance.
	 *
	 * @var QuestionnaireSubmissionRepository
	 */
	private $submission_repository;

	/**
	 * Questionnaire answer repository instance.
	 *
	 * @var QuestionnaireAnswerRepository
	 */
	private $answer_repository;

	/**
	 * Constructor.
	 */
	public function __construct() {
		$this->submission_repository = new QuestionnaireSubmissionRepository();
		$this->answer_repository     = new QuestionnaireAnswerRepository();
	}

	/**
	 * Parse the raw `questionnaire_answers` request value into an array.
	 *
	 * When sent via FormData the answers arrive as a JSON string; when sent via
	 * a JSON request body they arrive as a decoded array.
	 *
	 * @param mixed $raw Raw questionnaire_answers value.
	 * @return array Parsed answers array.
	 */
	public function parse_answers( $raw ) {
		if ( is_string( $raw ) ) {
			$decoded = json_decode( $raw, true );
			return is_array( $decoded ) ? $decoded : array();
		}

		if ( is_array( $raw ) ) {
			return $raw;
		}

		return array();
	}

	/**
	 * Sanitize and validate parsed answers.
	 *
	 * @param array $answers Parsed answers.
	 * @return array|WP_Error Sanitized answers, or WP_Error on invalid input.
	 */
	public function sanitize_answers( $answers ) {
		$sanitized = array();

		foreach ( $answers as $answer ) {
			if ( ! is_array( $answer ) ) {
				continue;
			}

			$question_type = in_array( $answer['question_type'] ?? '', self::VALID_TYPES, true ) ? $answer['question_type'] : 'short_text';
			$answer_value  = sanitize_text_field( $answer['answer_value'] ?? '' );
			$question_text = sanitize_text_field( $answer['question_text'] ?? '' );

			if ( 'email' === $question_type && '' !== $answer_value ) {
				$answer_value = sanitize_email( $answer_value );
				if ( '' !== $answer_value && ! is_email( $answer_value ) ) {
					return new WP_Error(
						'invalid_email',
						sprintf(
							/* translators: %s: question text */
							__( 'Please enter a valid email address for: %s', 'fair-form' ),
							$question_text
						),
						array( 'status' => 400 )
					);
				}
			}

			if ( 'phone' === $question_type && '' !== $answer_value ) {
				$normalized = self::normalize_phone( $answer_value );
				if ( ! preg_match( self::PHONE_NORMALIZED_PATTERN, $normalized ) ) {
					return new WP_Error(
						'invalid_phone',
						sprintf(
							/* translators: %s: question text */
							__( 'Enter a valid phone number with country code (for example +49 170 123 45 67) for: %s', 'fair-form' ),
							$question_text
						),
						array( 'status' => 400 )
					);
				}
				$answer_value = $normalized;
			}

			if ( 'url' === $question_type && '' !== $answer_value ) {
				$normalized = self::normalize_url( $answer_value );
				if ( ! self::is_valid_web_url( $normalized ) ) {
					return new WP_Error(
						'invalid_url',
						sprintf(
							/* translators: %s: question text */
							__( 'Please enter a valid web address for: %s', 'fair-form' ),
							$question_text
						),
						array( 'status' => 400 )
					);
				}
				$answer_value = $normalized;
			}

			if ( 'date' === $question_type && '' !== $answer_value ) {
				$normalized = self::normalize_date( $answer_value );
				if ( null === $normalized ) {
					return new WP_Error(
						'invalid_date',
						sprintf(
							/* translators: %s: question text */
							__( 'Please enter a valid date for: %s', 'fair-form' ),
							$question_text
						),
						array( 'status' => 400 )
					);
				}
				$answer_value = $normalized;
			}

			if ( 'datetime' === $question_type && '' !== $answer_value ) {
				$normalized = self::normalize_datetime( $answer_value );
				if ( null === $normalized ) {
					return new WP_Error(
						'invalid_datetime',
						sprintf(
							/* translators: %s: question text */
							__( 'Please enter a valid date and time for: %s', 'fair-form' ),
							$question_text
						),
						array( 'status' => 400 )
					);
				}
				$answer_value = $normalized;
			}

			$sanitized[] = array(
				'question_key'          => sanitize_key( $answer['question_key'] ?? '' ),
				'question_text'         => $question_text,
				'question_type'         => $question_type,
				'answer_value'          => $answer_value,
				'display_order'         => (int) ( $answer['display_order'] ?? 0 ),
				'extract_event_details' => ! empty( $answer['extract_event_details'] ),
			);
		}

		return $sanitized;
	}

	/**
	 * Strip separators (spaces, including NBSP/narrow NBSP, dots, parens,
	 * hyphens) from a phone value, leaving `+` followed by digits only.
	 *
	 * PHP's `\s` is ASCII-only even under the `/u` modifier, and
	 * `sanitize_text_field()` (already applied upstream) only trims ASCII
	 * whitespace, so NBSP survives to this point and must be listed via
	 * `\p{Z}` explicitly.
	 *
	 * @param string $value Raw phone value.
	 * @return string Normalized value.
	 */
	public static function normalize_phone( $value ) {
		return preg_replace( '/[\p{Z}\s\x{FEFF}.()-]/u', '', $value );
	}

	/**
	 * Prepend `https://` to a URL question value that has no scheme, so a
	 * bare domain (e.g. "example.com/my-event") is accepted as shorthand for
	 * the full web address. Mirrored by the JS twin in
	 * `fair-events-shared/src/questionnaire.js`'s `validateQuestions()`.
	 *
	 * @param string $value Raw URL value.
	 * @return string Value with a scheme, unchanged if it already had one.
	 */
	public static function normalize_url( $value ) {
		if ( ! preg_match( '#^[a-zA-Z][a-zA-Z\d+.-]*://#', $value ) ) {
			return 'https://' . $value;
		}
		return $value;
	}

	/**
	 * Whether a (already-schemed) value is a well-formed `http`/`https` web
	 * address. Rejects other schemes (`javascript:`, `file:`, …) and free
	 * text that doesn't parse as a URL at all.
	 *
	 * @param string $value URL value, expected to already carry a scheme.
	 * @return bool Whether the value is a valid http/https URL.
	 */
	public static function is_valid_web_url( $value ) {
		$filtered = filter_var( $value, FILTER_VALIDATE_URL );
		if ( false === $filtered ) {
			return false;
		}

		$scheme = wp_parse_url( $filtered, PHP_URL_SCHEME );
		return in_array( $scheme, array( 'http', 'https' ), true );
	}

	/**
	 * Validate a date question value (native `type="date"` value,
	 * `YYYY-MM-DD`) and re-serialize it, rejecting out-of-range values (e.g.
	 * `2024-02-30`) that `DateTime::createFromFormat()` would otherwise
	 * silently roll over to a different date.
	 *
	 * @param string $value Raw date value.
	 * @return string|null The value unchanged if valid, null otherwise.
	 */
	public static function normalize_date( $value ) {
		$date = \DateTime::createFromFormat( 'Y-m-d', $value );
		if ( false === $date || $date->format( 'Y-m-d' ) !== $value ) {
			return null;
		}
		return $value;
	}

	/**
	 * Validate a datetime question value (native `type="datetime-local"`
	 * value, `YYYY-MM-DDTHH:mm`) and normalize it to `Y-m-d H:i:00` (space
	 * separator, seconds appended) so it's directly consumable by the JS
	 * `formatSiteLocalDatetime()` helper without a second conversion layer.
	 * Stored as site-local wall-clock time, not converted to UTC.
	 *
	 * @param string $value Raw datetime-local value.
	 * @return string|null The normalized value if valid, null otherwise.
	 */
	public static function normalize_datetime( $value ) {
		$date = \DateTime::createFromFormat( 'Y-m-d\TH:i', $value );
		if ( false === $date || $date->format( 'Y-m-d\TH:i' ) !== $value ) {
			return null;
		}
		return $date->format( 'Y-m-d H:i:00' );
	}

	/**
	 * Process file uploads from the request and update answer values with the
	 * resulting attachment IDs.
	 *
	 * @param WP_REST_Request $request        Request object.
	 * @param array           $answers        Questionnaire answers to update.
	 * @param int             $event_date_id  Optional event date ID to link images to.
	 * @param int             $participant_id Participant ID to set as photo author.
	 * @return array|WP_Error Updated answers array or error.
	 */
	public function process_file_uploads( $request, $answers, $event_date_id = 0, $participant_id = 0 ) {
		$files = $request->get_file_params();
		if ( empty( $files ) ) {
			return $answers;
		}

		// Required for wp_handle_upload().
		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/image.php';
		require_once ABSPATH . 'wp-admin/includes/media.php';

		foreach ( $answers as $index => &$answer ) {
			if ( 'file_upload' !== ( $answer['question_type'] ?? '' ) ) {
				continue;
			}

			$file_key = 'fair_form_file_' . ( $answer['question_key'] ?? '' );
			if ( ! isset( $files[ $file_key ] ) ) {
				$answer['answer_value'] = '';
				continue;
			}

			$file = $files[ $file_key ];

			// Validate upload error.
			if ( UPLOAD_ERR_OK !== $file['error'] ) {
				return new WP_Error(
					'upload_error',
					__( 'File upload failed. Please try again.', 'fair-form' ),
					array( 'status' => 400 )
				);
			}

			// Validate file size.
			if ( $file['size'] > self::MAX_FILE_SIZE ) {
				return new WP_Error(
					'file_too_large',
					__( 'File is too large.', 'fair-form' ),
					array( 'status' => 400 )
				);
			}

			// Validate MIME type.
			$file_type = wp_check_filetype( $file['name'] );
			if ( empty( $file_type['type'] ) || ! in_array( $file_type['type'], self::ALLOWED_FILE_TYPES, true ) ) {
				return new WP_Error(
					'invalid_file_type',
					__( 'File type not allowed.', 'fair-form' ),
					array( 'status' => 400 )
				);
			}

			// Upload file.
			$upload = wp_handle_upload(
				$file,
				array(
					'test_form' => false,
					'test_type' => true,
				)
			);

			if ( isset( $upload['error'] ) ) {
				return new WP_Error(
					'upload_failed',
					$upload['error'],
					array( 'status' => 500 )
				);
			}

			// Create attachment in media library.
			$attachment_data = array(
				'post_mime_type' => $upload['type'],
				'post_title'     => sanitize_file_name( $file['name'] ),
				'post_content'   => '',
				'post_status'    => 'inherit',
			);

			$attachment_id = wp_insert_attachment( $attachment_data, $upload['file'] );
			if ( is_wp_error( $attachment_id ) ) {
				return new WP_Error(
					'attachment_failed',
					__( 'Failed to save uploaded file.', 'fair-form' ),
					array( 'status' => 500 )
				);
			}

			// Generate attachment metadata (thumbnails, etc.).
			$attachment_metadata = wp_generate_attachment_metadata( $attachment_id, $upload['file'] );
			wp_update_attachment_metadata( $attachment_id, $attachment_metadata );

			// Link image to event if event_date_id is set and fair-events plugin is active.
			if ( $event_date_id > 0 && class_exists( '\FairEvents\Database\EventPhotoRepository' ) ) {
				$photo_repo = new \FairEvents\Database\EventPhotoRepository();
				$photo_repo->set_event_date( $attachment_id, $event_date_id );
			}

			// Set participant as photo author (guarded: fair-audience-experimental's
			// `galleries` bundle may be inactive).
			if ( $participant_id > 0 && class_exists( '\FairAudienceExperimental\Database\PhotoParticipantRepository' ) ) {
				$photo_participant_repo = new \FairAudienceExperimental\Database\PhotoParticipantRepository();
				$photo_participant_repo->set_author( $attachment_id, $participant_id );
			}

			// Store attachment ID as the answer value.
			$answer['answer_value'] = (string) $attachment_id;
		}

		return $answers;
	}

	/**
	 * For url answers opted into extraction, fetch the linked page server-side
	 * and store whatever event details it publishes alongside the answer.
	 *
	 * Extraction never blocks submission: an unreachable page, a non-HTML
	 * response, or a page with no usable data simply leaves the answer
	 * without captured details — this method never returns a WP_Error.
	 *
	 * @param array $answers Sanitized questionnaire answers.
	 * @return array Updated answers array (`extract_event_details` stripped,
	 *               `answer_meta` set on url answers where extraction found data).
	 */
	public function process_url_extractions( $answers ) {
		foreach ( $answers as &$answer ) {
			$extract = ! empty( $answer['extract_event_details'] );
			unset( $answer['extract_event_details'] );

			if ( ! $extract
				|| 'url' !== ( $answer['question_type'] ?? '' )
				|| empty( $answer['answer_value'] ) ) {
				continue;
			}

			$body = SafeUrlFetcher::fetch( $answer['answer_value'] );
			if ( is_wp_error( $body ) ) {
				continue;
			}

			$metadata = PageMetadataParser::parse( $body );
			if ( empty( $metadata['found'] ) ) {
				continue;
			}

			$captured = array( 'source' => $metadata['source'] );
			foreach ( $metadata['found'] as $field ) {
				$key              = 'start' === $field ? 'start_datetime' : ( 'end' === $field ? 'end_datetime' : $field );
				$captured[ $key ] = $metadata[ $key ];
			}
			if ( in_array( 'start', $metadata['found'], true ) ) {
				$captured['all_day'] = $metadata['all_day'];
			}

			$answer['answer_meta'] = wp_json_encode( $captured );
		}

		return $answers;
	}

	/**
	 * Save questionnaire answers for a participant.
	 *
	 * @param int|null $participant_id Participant ID, or null for anonymous submissions.
	 * @param array    $answers        Questionnaire answers to persist.
	 * @param int      $event_date_id  Optional event date ID.
	 * @param int      $post_id        Optional post ID.
	 * @param string   $title          Submission title (e.g. "Fair Form", "Event Signup").
	 * @param bool     $reuse_existing When true, an existing submission with the same
	 *                                 participant, event date and title is reused
	 *                                 (its answers replaced) instead of inserting a
	 *                                 new one. Keeps re-submits/payment retries idempotent.
	 * @param string   $form_id        Stable UUID from the block attribute (empty for non-block submissions).
	 * @param string   $form_title     Human-readable form label from the block attribute.
	 * @return int Submission ID, or 0 on failure.
	 */
	public function save_answers( $participant_id, $answers, $event_date_id = 0, $post_id = 0, $title = '', $reuse_existing = false, $form_id = '', $form_title = '' ) {
		$title = '' !== $title ? $title : __( 'Fair Form', 'fair-form' );

		$submission = null;

		// Reuse is only possible when we have a participant to match against.
		if ( $reuse_existing && $event_date_id > 0 && null !== $participant_id ) {
			$existing = $this->submission_repository->get_by_filters(
				array(
					'participant_id' => $participant_id,
					'event_date_id'  => $event_date_id,
					'title'          => $title,
				)
			);
			if ( ! empty( $existing ) ) {
				$submission = $existing[0];
			}
		}

		if ( null === $submission ) {
			$submission_data = array(
				'participant_id' => $participant_id,
				'title'          => $title,
			);

			if ( $event_date_id > 0 ) {
				$submission_data['event_date_id'] = $event_date_id;
			}

			if ( $post_id > 0 ) {
				$submission_data['post_id'] = $post_id;
			}

			if ( '' !== $form_id ) {
				$submission_data['form_id'] = $form_id;
			}

			if ( '' !== $form_title ) {
				$submission_data['form_title'] = $form_title;
			}

			$submission = new QuestionnaireSubmission();
			$submission->populate( $submission_data );

			if ( ! $submission->save() ) {
				return 0;
			}
		}

		// save_answers() atomically replaces any existing answers for the submission.
		$this->answer_repository->save_answers( $submission->id, $answers );

		return $submission->id;
	}
}
