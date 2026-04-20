<?php
/**
 * Invitation Token model for Fair Events
 *
 * @package FairEvents
 */

namespace FairEvents\Models;

defined( 'WPINC' ) || die;

/**
 * Invitation Token model class
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class InvitationToken {

	/**
	 * Token ID
	 *
	 * @var int|null
	 */
	public $id;

	/**
	 * Event date ID
	 *
	 * @var int
	 */
	public $event_date_id;

	/**
	 * Group ID that grants the invitation right
	 *
	 * @var int
	 */
	public $group_id;

	/**
	 * Inviter participant ID (group member who created the link)
	 *
	 * @var int
	 */
	public $inviter_participant_id;

	/**
	 * Token string for URL
	 *
	 * @var string
	 */
	public $token;

	/**
	 * Invitee participant ID (filled on signup)
	 *
	 * @var int|null
	 */
	public $invitee_participant_id;

	/**
	 * Maximum uses for this token
	 *
	 * @var int
	 */
	public $max_uses = 1;

	/**
	 * Current usage count
	 *
	 * @var int
	 */
	public $uses_count = 0;

	/**
	 * Expiration datetime
	 *
	 * @var string|null
	 */
	public $expires_at;

	/**
	 * Created at timestamp
	 *
	 * @var string
	 */
	public $created_at;

	/**
	 * Get table name
	 *
	 * @return string Table name with prefix.
	 */
	private static function get_table_name() {
		global $wpdb;
		return $wpdb->prefix . 'fair_events_invitation_tokens';
	}

	/**
	 * Get invitation token by ID
	 *
	 * @param int $id Token ID.
	 * @return InvitationToken|null Token object or null if not found.
	 */
	public static function get_by_id( $id ) {
		global $wpdb;

		$result = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE id = %d LIMIT 1',
				self::get_table_name(),
				$id
			)
		);

		return $result ? self::hydrate( $result ) : null;
	}

	/**
	 * Get invitation token by token string
	 *
	 * @param string $token Plain token from URL.
	 * @return InvitationToken|null Token object or null if not found.
	 */
	public static function get_by_token( $token ) {
		global $wpdb;

		$result = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE token = %s LIMIT 1',
				self::get_table_name(),
				$token
			)
		);

		return $result ? self::hydrate( $result ) : null;
	}

	/**
	 * Get all tokens for an event date
	 *
	 * @param int $event_date_id Event date ID.
	 * @return InvitationToken[] Array of token objects.
	 */
	public static function get_all_by_event_date_id( $event_date_id ) {
		global $wpdb;

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE event_date_id = %d ORDER BY created_at DESC',
				self::get_table_name(),
				$event_date_id
			)
		);

		return array_map( array( self::class, 'hydrate' ), $results ? $results : array() );
	}

	/**
	 * Get tokens created by a specific inviter for an event date
	 *
	 * @param int $event_date_id Event date ID.
	 * @param int $inviter_participant_id Inviter participant ID.
	 * @return InvitationToken[] Array of token objects.
	 */
	public static function get_by_inviter( $event_date_id, $inviter_participant_id ) {
		global $wpdb;

		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT * FROM %i WHERE event_date_id = %d AND inviter_participant_id = %d ORDER BY created_at DESC',
				self::get_table_name(),
				$event_date_id,
				$inviter_participant_id
			)
		);

		return array_map( array( self::class, 'hydrate' ), $results ? $results : array() );
	}

	/**
	 * Create a new invitation token
	 *
	 * @param int         $event_date_id          Event date ID.
	 * @param int         $group_id               Group ID.
	 * @param int         $inviter_participant_id  Inviter participant ID.
	 * @param int         $max_uses               Maximum uses (default 1).
	 * @param string|null $expires_at           Expiration datetime or null.
	 * @return InvitationToken|null Created token or null on failure.
	 */
	public static function create( $event_date_id, $group_id, $inviter_participant_id, $max_uses = 1, $expires_at = null ) {
		global $wpdb;

		$token = wp_generate_password( 32, false );

		$data = array(
			'event_date_id'          => $event_date_id,
			'group_id'               => $group_id,
			'inviter_participant_id' => $inviter_participant_id,
			'token'                  => $token,
			'max_uses'               => max( 1, (int) $max_uses ),
			'expires_at'             => $expires_at,
		);

		$format = array( '%d', '%d', '%d', '%s', '%d', '%s' );

		$result = $wpdb->insert( self::get_table_name(), $data, $format );

		if ( $result ) {
			return self::get_by_id( $wpdb->insert_id );
		}

		return null;
	}

	/**
	 * Increment uses_count and optionally record invitee
	 *
	 * @param int $invitee_participant_id Invitee participant ID.
	 * @return bool True on success.
	 */
	public function record_use( $invitee_participant_id ) {
		global $wpdb;

		$update_data   = array(
			'uses_count'             => $this->uses_count + 1,
			'invitee_participant_id' => $invitee_participant_id,
		);
		$update_format = array( '%d', '%d' );

		$result = $wpdb->update(
			self::get_table_name(),
			$update_data,
			array( 'id' => $this->id ),
			$update_format,
			array( '%d' )
		);

		if ( false !== $result ) {
			$this->uses_count             = $update_data['uses_count'];
			$this->invitee_participant_id = $invitee_participant_id;
			return true;
		}

		return false;
	}

	/**
	 * Check if this token is still valid (not expired, not exhausted)
	 *
	 * @return bool True if valid.
	 */
	public function is_valid() {
		if ( $this->uses_count >= $this->max_uses ) {
			return false;
		}

		if ( $this->expires_at && strtotime( $this->expires_at ) < time() ) {
			return false;
		}

		return true;
	}

	/**
	 * Delete token
	 *
	 * @return bool True on success.
	 */
	public function delete() {
		global $wpdb;

		if ( ! $this->id ) {
			return false;
		}

		return $wpdb->delete(
			self::get_table_name(),
			array( 'id' => $this->id ),
			array( '%d' )
		) !== false;
	}

	/**
	 * Hydrate from database row
	 *
	 * @param object $row Database row.
	 * @return InvitationToken Token object.
	 */
	private static function hydrate( $row ) {
		$item                         = new self();
		$item->id                     = (int) $row->id;
		$item->event_date_id          = (int) $row->event_date_id;
		$item->group_id               = (int) $row->group_id;
		$item->inviter_participant_id = (int) $row->inviter_participant_id;
		$item->token                  = $row->token;
		$item->invitee_participant_id = null !== $row->invitee_participant_id ? (int) $row->invitee_participant_id : null;
		$item->max_uses               = (int) $row->max_uses;
		$item->uses_count             = (int) $row->uses_count;
		$item->expires_at             = $row->expires_at;
		$item->created_at             = $row->created_at;

		return $item;
	}

	/**
	 * Convert to array
	 *
	 * @return array Data as array.
	 */
	public function to_array() {
		return array(
			'id'                     => $this->id,
			'event_date_id'          => $this->event_date_id,
			'group_id'               => $this->group_id,
			'inviter_participant_id' => $this->inviter_participant_id,
			'token'                  => $this->token,
			'invitee_participant_id' => $this->invitee_participant_id,
			'max_uses'               => $this->max_uses,
			'uses_count'             => $this->uses_count,
			'expires_at'             => $this->expires_at,
			'created_at'             => $this->created_at,
		);
	}
}
