<?php
/**
 * Audience migration
 *
 * @package FairAudience
 */

namespace FairAudience\Services;

use FairAudience\Database\ParticipantRepository;
use FairAudience\Models\EmailConsentLog;
use FairAudience\Models\Participant;

defined( 'WPINC' ) || die;

/**
 * Exports the audience to CSV and imports such a file on another site
 * (#2218). The contract is documented in fair-audience/AUDIENCE_MIGRATION.md.
 *
 * Only contact details, the general marketing preference and the weekly
 * summary opt-out move between sites. Feed subscriptions, confirmation
 * status, accounts, tokens, history and IDs never do: feed IDs mean nothing
 * on another site ({@see LegacyFeedPreferences::for_import()}), and a
 * destination must not treat a person as confirmed on another site's word.
 *
 * An import never changes an existing member. A row whose email is already
 * present is skipped, as "already present" when every transferable field
 * matches and as a conflict otherwise.
 */
class AudienceMigration {

	/**
	 * Value of the format_version column this version writes and reads.
	 */
	const FORMAT_VERSION = '1';

	/**
	 * Columns, in export order. Every one is required on import.
	 */
	const COLUMNS = array( 'format_version', 'name', 'surname', 'email', 'phone', 'instagram', 'email_profile', 'weekly_summary_opt_out' );

	/**
	 * Optional legacy column, accepted and ignored: both values create no
	 * destination feed subscriptions.
	 */
	const LEGACY_FEED_MODE_COLUMN = 'weekly_feed_mode';

	/**
	 * Fields compared with an existing member, in report order.
	 */
	const COMPARED_FIELDS = array( 'name', 'surname', 'phone', 'instagram', 'email_profile', 'weekly_summary_opt_out' );

	/**
	 * Largest accepted file, in bytes (5 MiB).
	 */
	const MAX_BYTES = 5242880;

	/**
	 * Most data rows accepted in one file.
	 */
	const MAX_ROWS = 10000;

	/**
	 * Consent log source for members created by an import.
	 *
	 * Also tells the pending-subscription timeout to leave the member's
	 * imported marketing preference alone.
	 */
	const CONSENT_SOURCE = 'csv_import';

	/**
	 * Longest value each text field holds, in characters (the column sizes).
	 */
	const MAX_LENGTHS = array(
		'name'      => 255,
		'surname'   => 255,
		'phone'     => 50,
		'instagram' => 255,
	);

	/**
	 * Accepted spellings of the weekly_summary_opt_out values.
	 */
	const BOOLEANS = array(
		'1'     => true,
		'true'  => true,
		'yes'   => true,
		'0'     => false,
		'false' => false,
		'no'    => false,
	);

	/**
	 * Looks a member up by normalized email: returns the transferable fields or null.
	 *
	 * @var callable
	 */
	private $find;

	/**
	 * Inserts a new member from normalized values: returns true on success.
	 *
	 * @var callable
	 */
	private $insert;

	/**
	 * Constructor.
	 *
	 * @param callable|null $find   fn( string $email ): ?array, defaults to the participants table.
	 * @param callable|null $insert fn( array $values ): bool, defaults to the participants table.
	 */
	public function __construct( ?callable $find = null, ?callable $insert = null ) {
		$this->find   = $find ?? array( self::class, 'find_member' );
		$this->insert = $insert ?? array( self::class, 'insert_member' );
	}

	/**
	 * Build the export file for the whole audience.
	 *
	 * @param Participant[] $participants Every participant.
	 * @return string CSV text.
	 */
	public static function export_csv( array $participants ): string {
		$rows = array();
		foreach ( $participants as $participant ) {
			$rows[] = array(
				self::FORMAT_VERSION,
				(string) $participant->name,
				(string) $participant->surname,
				(string) $participant->email,
				(string) $participant->phone,
				(string) $participant->instagram,
				(string) $participant->email_profile,
				$participant->weekly_summary_opt_out ? '1' : '0',
			);
		}
		return AudienceCsv::serialize( self::COLUMNS, $rows );
	}

	/**
	 * Check a file's structure and read its rows, without writing anything.
	 *
	 * @param string $text File contents.
	 * @return array{rows: array<int, array<string, string>>, error: array{code: string, message: string}|null}
	 *     Rows keyed by line number, each mapping column name to its unescaped value.
	 */
	public static function read( string $text ): array {
		if ( strlen( $text ) > self::MAX_BYTES ) {
			return self::structure_error( 'file_too_large', __( 'The file is larger than 5 MB. Split it into smaller files and import each one.', 'fair-audience' ) );
		}

		$parsed = AudienceCsv::parse( $text );
		if ( 'encoding' === $parsed['error'] ) {
			return self::structure_error( 'invalid_encoding', __( 'The file is not UTF-8 text. Export it again from Fair Audience, or save it as "CSV UTF-8".', 'fair-audience' ) );
		}
		if ( 'malformed' === $parsed['error'] ) {
			return self::structure_error(
				'malformed_csv',
				/* translators: %d: line number in the CSV file */
				sprintf( __( 'The file is not valid CSV: check the quotes on line %d.', 'fair-audience' ), $parsed['line'] )
			);
		}

		$records = $parsed['records'];
		if ( empty( $records ) ) {
			return self::structure_error( 'empty_file', __( 'The file is empty.', 'fair-audience' ) );
		}

		// Records are keyed by line number, which array_shift() would renumber.
		$header_line = array_key_first( $records );
		$header      = array_map(
			static function ( $name ) {
				return strtolower( trim( $name ) );
			},
			$records[ $header_line ]
		);
		unset( $records[ $header_line ] );

		$duplicates = array_unique( array_diff_assoc( $header, array_unique( $header ) ) );
		if ( $duplicates ) {
			return self::structure_error(
				'duplicate_columns',
				/* translators: %s: comma-separated column names */
				sprintf( __( 'These columns appear more than once: %s.', 'fair-audience' ), implode( ', ', $duplicates ) )
			);
		}

		$missing = array_diff( self::COLUMNS, $header );
		if ( $missing ) {
			return self::structure_error(
				'missing_columns',
				/* translators: %s: comma-separated column names */
				sprintf( __( 'These required columns are missing: %s. Use a file exported from Fair Audience.', 'fair-audience' ), implode( ', ', $missing ) )
			);
		}

		$unsupported = array_diff( $header, self::COLUMNS, array( self::LEGACY_FEED_MODE_COLUMN ) );
		if ( $unsupported ) {
			return self::structure_error(
				'unsupported_columns',
				/* translators: %s: comma-separated column names */
				sprintf( __( 'These columns are not supported: %s. Remove them and import again.', 'fair-audience' ), implode( ', ', $unsupported ) )
			);
		}

		if ( count( $records ) > self::MAX_ROWS ) {
			return self::structure_error(
				'too_many_rows',
				/* translators: %d: maximum number of rows */
				sprintf( __( 'The file has more than %d rows. Split it into smaller files and import each one.', 'fair-audience' ), self::MAX_ROWS )
			);
		}

		$rows = array();
		foreach ( $records as $line => $record ) {
			if ( count( $record ) !== count( $header ) ) {
				return self::structure_error(
					'malformed_csv',
					/* translators: 1: line number in the CSV file, 2: number of values found, 3: number of columns */
					sprintf( __( 'Line %1$d has %2$d values, but the file has %3$d columns.', 'fair-audience' ), $line, count( $record ), count( $header ) )
				);
			}

			$row = array_combine( $header, array_map( array( AudienceCsv::class, 'unescape_cell' ), $record ) );
			if ( self::FORMAT_VERSION !== trim( $row['format_version'] ) ) {
				return self::structure_error(
					'unsupported_version',
					/* translators: %d: line number in the CSV file */
					sprintf( __( 'Line %d was exported in a format version this site cannot read. Update Fair Audience on this site, or export the file again.', 'fair-audience' ), $line )
				);
			}

			$rows[ $line ] = $row;
		}

		if ( empty( $rows ) ) {
			return self::structure_error( 'empty_file', __( 'The file has no audience members.', 'fair-audience' ) );
		}

		return array(
			'rows'  => $rows,
			'error' => null,
		);
	}

	/**
	 * Validate and normalize one row.
	 *
	 * Email is trimmed and lowercased; other text is trimmed. Enum and
	 * boolean values are trimmed and lowercased. Invalid values are reported,
	 * never repaired.
	 *
	 * @param array<string, string> $row Column name to value.
	 * @return array{kind: string, values: array<string, mixed>, errors: array<int, array{field: string, message: string}>}
	 *     `kind` is 'ok', 'missing_email' or 'invalid'.
	 */
	public static function normalize_row( array $row ): array {
		$errors = array();
		$values = array();

		foreach ( array( 'name', 'surname', 'phone', 'instagram' ) as $field ) {
			$value            = trim( (string) ( $row[ $field ] ?? '' ) );
			$values[ $field ] = $value;

			if ( 'name' === $field && '' === $value ) {
				$errors[] = self::field_error( $field, __( 'The first name is required.', 'fair-audience' ) );
			} elseif ( self::length( $value ) > self::MAX_LENGTHS[ $field ] ) {
				$errors[] = self::field_error(
					$field,
					/* translators: 1: column name, 2: maximum number of characters */
					sprintf( __( '%1$s is longer than %2$d characters.', 'fair-audience' ), $field, self::MAX_LENGTHS[ $field ] )
				);
			} elseif ( sanitize_text_field( $value ) !== $value ) {
				$errors[] = self::field_error(
					$field,
					/* translators: %s: column name */
					sprintf( __( '%s contains line breaks, tags or other characters a contact field cannot hold.', 'fair-audience' ), $field )
				);
			}
		}

		$email           = strtolower( trim( (string) ( $row['email'] ?? '' ) ) );
		$values['email'] = $email;
		if ( '' !== $email && ( ! is_email( $email ) || sanitize_email( $email ) !== $email ) ) {
			$errors[] = self::field_error( 'email', __( 'The email address is not valid.', 'fair-audience' ) );
		}

		$profile = strtolower( trim( (string) ( $row['email_profile'] ?? '' ) ) );
		if ( ! in_array( $profile, array( 'minimal', 'marketing', 'declined' ), true ) ) {
			$errors[] = self::field_error( 'email_profile', __( 'email_profile must be minimal, marketing or declined.', 'fair-audience' ) );
		}

		$opt_out = strtolower( trim( (string) ( $row['weekly_summary_opt_out'] ?? '' ) ) );
		if ( ! array_key_exists( $opt_out, self::BOOLEANS ) ) {
			$errors[] = self::field_error( 'weekly_summary_opt_out', __( 'weekly_summary_opt_out must be 1 or 0.', 'fair-audience' ) );
		}

		$legacy_mode = strtolower( trim( (string) ( $row[ self::LEGACY_FEED_MODE_COLUMN ] ?? '' ) ) );
		if ( ! in_array( $legacy_mode, array( '', WeeklyFeeds::LEGACY_MODE_ALL, 'selected' ), true ) ) {
			$errors[] = self::field_error( self::LEGACY_FEED_MODE_COLUMN, __( 'weekly_feed_mode must be all, selected or empty.', 'fair-audience' ) );
		}

		if ( ! $errors ) {
			// The legacy feed mode is dropped here: it is not a preference and
			// creates no destination subscriptions.
			$preferences                      = LegacyFeedPreferences::for_import(
				array(
					'email_profile'          => $profile,
					'weekly_summary_opt_out' => self::BOOLEANS[ $opt_out ],
					'weekly_feed_mode'       => $legacy_mode,
				)
			);
			$values['email_profile']          = $preferences['email_profile'];
			$values['weekly_summary_opt_out'] = $preferences['weekly_summary_opt_out'];
		}

		if ( $errors ) {
			$kind = 'invalid';
		} elseif ( '' === $email ) {
			$kind = 'missing_email';
		} else {
			$kind = 'ok';
		}

		return array(
			'kind'   => $kind,
			'values' => $values,
			'errors' => $errors,
		);
	}

	/**
	 * Transferable fields that differ between an imported row and a member.
	 *
	 * @param array<string, mixed> $incoming Normalized row values.
	 * @param array<string, mixed> $existing The destination member's fields.
	 * @return string[] Field names, in {@see self::COMPARED_FIELDS} order.
	 */
	public static function differing_fields( array $incoming, array $existing ): array {
		$differing = array();
		foreach ( self::COMPARED_FIELDS as $field ) {
			if ( 'weekly_summary_opt_out' === $field ) {
				$same = ! empty( $incoming[ $field ] ) === ! empty( $existing[ $field ] );
			} else {
				$same = 0 === strcmp( (string) $incoming[ $field ], trim( (string) ( $existing[ $field ] ?? '' ) ) );
			}
			if ( ! $same ) {
				$differing[] = $field;
			}
		}
		return $differing;
	}

	/**
	 * Opt-outs in the file that the destination member does not have.
	 *
	 * The import leaves the member as it is, so these need an administrator
	 * before mailing that member resumes.
	 *
	 * @param array<string, mixed> $incoming Normalized row values.
	 * @param array<string, mixed> $existing The destination member's fields.
	 * @return string[] 'email_profile' when the file has no marketing consent but the
	 *                  member has, 'weekly_summary_opt_out' when only the file opts out.
	 */
	public static function untransferred_opt_outs( array $incoming, array $existing ): array {
		$opt_outs = array();
		if ( 'marketing' !== $incoming['email_profile'] && 'marketing' === ( $existing['email_profile'] ?? '' ) ) {
			$opt_outs[] = 'email_profile';
		}
		if ( $incoming['weekly_summary_opt_out'] && empty( $existing['weekly_summary_opt_out'] ) ) {
			$opt_outs[] = 'weekly_summary_opt_out';
		}
		return $opt_outs;
	}

	/**
	 * Import a file.
	 *
	 * Structure is checked before anything is written; a structural problem
	 * rejects the whole file. Rows are then processed one at a time.
	 *
	 * @param string $text File contents.
	 * @return array{error: array{code: string, message: string}|null, result: array|null}
	 */
	public function import( string $text ): array {
		$read = self::read( $text );
		if ( $read['error'] ) {
			return array(
				'error'  => $read['error'],
				'result' => null,
			);
		}

		$result = array(
			'total'           => count( $read['rows'] ),
			'imported'        => array(),
			'already_present' => array(),
			'missing_email'   => array(),
			'conflicts'       => array(),
			'invalid'         => array(),
			'failed'          => array(),
		);

		foreach ( $read['rows'] as $line => $row ) {
			$normalized = self::normalize_row( $row );
			$values     = $normalized['values'];
			$identity   = array(
				'line'  => $line,
				'name'  => trim( $values['name'] . ' ' . $values['surname'] ),
				'email' => $values['email'],
			);

			if ( 'invalid' === $normalized['kind'] ) {
				$result['invalid'][] = $identity + array( 'errors' => $normalized['errors'] );
				continue;
			}
			if ( 'missing_email' === $normalized['kind'] ) {
				$result['missing_email'][] = $identity;
				continue;
			}

			$existing = call_user_func( $this->find, $values['email'] );
			if ( null === $existing ) {
				if ( call_user_func( $this->insert, $values ) ) {
					$result['imported'][] = $identity;
					continue;
				}
				// Another request may have added the address meanwhile; the
				// unique email index refused the second copy.
				$existing = call_user_func( $this->find, $values['email'] );
				if ( null === $existing ) {
					$result['failed'][] = $identity;
					continue;
				}
			}

			$differing = self::differing_fields( $values, $existing );
			if ( ! $differing ) {
				$result['already_present'][] = $identity;
				continue;
			}

			$result['conflicts'][] = $identity + array(
				'fields'                => $differing,
				'untransferred_opt_out' => self::untransferred_opt_outs( $values, $existing ),
			);
		}

		return array(
			'error'  => null,
			'result' => $result,
		);
	}

	/**
	 * Default lookup: the participant with this email, as transferable fields.
	 *
	 * @param string $email Normalized email.
	 * @return array<string, mixed>|null
	 */
	public static function find_member( string $email ): ?array {
		$participant = ( new ParticipantRepository() )->get_by_email( $email );
		if ( ! $participant || strtolower( trim( (string) $participant->email ) ) !== $email ) {
			return null;
		}
		return array(
			'name'                   => $participant->name,
			'surname'                => $participant->surname,
			'phone'                  => $participant->phone,
			'instagram'              => $participant->instagram,
			'email_profile'          => $participant->email_profile,
			'weekly_summary_opt_out' => (bool) $participant->weekly_summary_opt_out,
		);
	}

	/**
	 * Default insert: a new pending participant with no feed subscriptions,
	 * no account and no tokens, and a consent log entry. Sends nothing.
	 *
	 * @param array<string, mixed> $values Normalized row values.
	 * @return bool Success.
	 */
	public static function insert_member( array $values ): bool {
		$participant = new Participant(
			array(
				'name'                   => $values['name'],
				'surname'                => $values['surname'],
				'email'                  => $values['email'],
				'phone'                  => $values['phone'],
				'instagram'              => $values['instagram'],
				'email_profile'          => $values['email_profile'],
				'weekly_summary_opt_out' => $values['weekly_summary_opt_out'] ? 1 : 0,
				'weekly_feed_mode'       => 'selected',
				'status'                 => 'pending',
			)
		);

		if ( ! $participant->save() || ! $participant->id ) {
			return false;
		}

		EmailConsentLog::create(
			array(
				'participant_id' => $participant->id,
				'old_profile'    => null,
				'new_profile'    => $participant->email_profile,
				'source'         => self::CONSENT_SOURCE,
				'comment'        => __( 'Imported from another Fair Audience site; awaiting confirmation on this site.', 'fair-audience' ),
			)
		);

		return true;
	}

	/**
	 * Build a structural error result.
	 *
	 * @param string $code    Error code.
	 * @param string $message Translated message.
	 * @return array{rows: array, error: array{code: string, message: string}}
	 */
	private static function structure_error( string $code, string $message ): array {
		return array(
			'rows'  => array(),
			'error' => array(
				'code'    => $code,
				'message' => $message,
			),
		);
	}

	/**
	 * Build a row-level error.
	 *
	 * @param string $field   Column name.
	 * @param string $message Translated message.
	 * @return array{field: string, message: string}
	 */
	private static function field_error( string $field, string $message ): array {
		return array(
			'field'   => $field,
			'message' => $message,
		);
	}

	/**
	 * Length in characters.
	 *
	 * @param string $value UTF-8 text.
	 * @return int
	 */
	private static function length( string $value ): int {
		return function_exists( 'mb_strlen' ) ? mb_strlen( $value, 'UTF-8' ) : (int) preg_match_all( '/./us', $value );
	}
}
