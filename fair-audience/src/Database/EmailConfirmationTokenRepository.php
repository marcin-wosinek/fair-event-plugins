<?php
/**
 * Email Confirmation Token Repository
 *
 * @package FairAudience
 */

namespace FairAudience\Database;

use FairAudience\Models\EmailConfirmationToken;

defined( 'WPINC' ) || die;

/**
 * Repository for email confirmation token data access.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class EmailConfirmationTokenRepository {

	/**
	 * Token expiration time in hours.
	 */
	const EXPIRATION_HOURS = 48;

	/**
	 * Get table name.
	 *
	 * @return string Table name.
	 */
	private function get_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'fair_audience_email_confirmation_tokens';
	}

	/**
	 * Get token by token string.
	 *
	 * @param string $token Token string.
	 * @return EmailConfirmationToken|null Token or null if not found.
	 */
	public function get_by_token( $token ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$result = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE token = %s',
				$table_name,
				$token
			),
			ARRAY_A
		);

		return $result ? new EmailConfirmationToken( $result ) : null;
	}

	/**
	 * Get token by participant ID.
	 *
	 * @param int $participant_id Participant ID.
	 * @return EmailConfirmationToken|null Token or null if not found.
	 */
	public function get_by_participant_id( $participant_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		$result = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE participant_id = %d',
				$table_name,
				$participant_id
			),
			ARRAY_A
		);

		return $result ? new EmailConfirmationToken( $result ) : null;
	}

	/**
	 * Create a new token for a participant.
	 *
	 * @param int $participant_id Participant ID.
	 * @return EmailConfirmationToken|null Created token or null on failure.
	 */
	public function create_token( $participant_id ) {
		// Delete any existing token for this participant.
		$this->delete_by_participant_id( $participant_id );

		// Generate a random 32-character token.
		$token_string = wp_generate_password( 32, false );

		// Calculate expiration time.
		$expires_at = gmdate( 'Y-m-d H:i:s', time() + ( self::EXPIRATION_HOURS * 60 * 60 ) );

		$token = new EmailConfirmationToken(
			array(
				'participant_id' => $participant_id,
				'token'          => $token_string,
				'expires_at'     => $expires_at,
			)
		);

		if ( $token->save() ) {
			return $token;
		}

		return null;
	}

	/**
	 * Delete token by participant ID.
	 *
	 * @param int $participant_id Participant ID.
	 * @return bool Success.
	 */
	public function delete_by_participant_id( $participant_id ) {
		global $wpdb;

		$table_name = $this->get_table_name();

		return $wpdb->delete(
			$table_name,
			array( 'participant_id' => $participant_id ),
			array( '%d' )
		) !== false;
	}

	/**
	 * Delete expired tokens.
	 *
	 * @return int Number of deleted tokens.
	 */
	public function delete_expired() {
		global $wpdb;

		$table_name = $this->get_table_name();
		$now        = current_time( 'mysql', true );

		return $wpdb->query(
			$wpdb->prepare(
				'DELETE FROM %i WHERE expires_at < %s',
				$table_name,
				$now
			)
		);
	}
}
