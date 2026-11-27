<?php
/**
 * Per-feed WhatsApp sharing reminders.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\WhatsApp;

defined( 'WPINC' ) || die;

/**
 * Stores one sharing reminder per event feed, keyed by the feed's stable ID:
 * whether it is on, its weekly day and time, the designated collaborator, the
 * consent given for that collaborator's number and the approved template.
 *
 * Each reminder is its own option (never autoloaded), so saving one feed's
 * reminder never rewrites another. The collaborator is either a member of
 * the team member directory, whose number is read from the directory at
 * every use, or a standalone name and number. Consent is stored as a
 * fingerprint of the number it was given for: once the number in effect
 * differs, the reminder pauses until an administrator confirms again.
 *
 * The template's static button must open the feed's weekly-summary page;
 * the URL it was checked against is kept with it, so a renamed feed or a
 * moved site pauses sending until a matching template is chosen.
 */
class SharingReminders {
	public const INDEX_OPTION  = 'fair_events_experimental_whatsapp_reminders';
	public const OPTION_PREFIX = 'fair_events_experimental_whatsapp_reminder_';

	public const MAX_NAME_LENGTH = 100;

	/** Recipient kinds. */
	public const KIND_MEMBER     = 'member';
	public const KIND_STANDALONE = 'standalone';

	/**
	 * Settings of a reminder that has not been saved yet.
	 */
	public const DEFAULTS = array(
		'enabled'     => false,
		'day_of_week' => 1,
		'time_of_day' => '10:00',
		'recipient'   => null,
		'consent'     => null,
		'template'    => null,
	);

	/**
	 * Feed IDs that have a reminder.
	 *
	 * @return int[]
	 */
	public static function ids() {
		$index = get_option( self::INDEX_OPTION, array() );
		return is_array( $index ) ? array_values( array_unique( array_filter( array_map( 'absint', $index ) ) ) ) : array();
	}

	/**
	 * One feed's reminder, read past this request's option cache so a cron
	 * run sees what an administrator saved meanwhile.
	 *
	 * @param int $source_id Event feed ID.
	 * @return array|null Normalized reminder, or null when there is none.
	 */
	public static function get( $source_id ) {
		$source_id = absint( $source_id );
		if ( ! $source_id ) {
			return null;
		}
		wp_cache_delete( self::option( $source_id ), 'options' );
		wp_cache_delete( 'notoptions', 'options' );
		$stored = get_option( self::option( $source_id ), null );
		return is_array( $stored ) ? self::normalize( $stored ) : null;
	}

	/**
	 * Save a feed's reminder.
	 *
	 * @param int   $source_id Event feed ID.
	 * @param array $reminder  Reminder fields, normalized here.
	 * @return array|null The saved reminder, or null when it could not be saved.
	 */
	public static function save( $source_id, array $reminder ) {
		$source_id = absint( $source_id );
		if ( ! $source_id ) {
			return null;
		}
		$normalized = self::normalize( $reminder );
		$option     = self::option( $source_id );
		if ( false === get_option( $option, false ) ) {
			add_option( $option, $normalized, '', false );
		} else {
			update_option( $option, $normalized, false );
		}

		$index = self::ids();
		if ( ! in_array( $source_id, $index, true ) ) {
			$index[] = $source_id;
			update_option( self::INDEX_OPTION, $index, false );
		}
		return self::get( $source_id );
	}

	/**
	 * Remove a feed's reminder.
	 *
	 * @param int $source_id Event feed ID.
	 * @return bool Whether there was one.
	 */
	public static function delete( $source_id ) {
		$source_id = absint( $source_id );
		$existed   = null !== self::get( $source_id );
		delete_option( self::option( $source_id ) );
		$index = self::ids();
		$kept  = array_values( array_diff( $index, array( $source_id ) ) );
		if ( count( $kept ) !== count( $index ) ) {
			update_option( self::INDEX_OPTION, $kept, false );
		}
		return $existed;
	}

	/**
	 * Name of a feed's reminder option, or of one of its state options.
	 *
	 * @param int    $source_id Event feed ID.
	 * @param string $suffix    '' for the reminder, or e.g. 'next_run'.
	 * @return string
	 */
	public static function option( $source_id, $suffix = '' ) {
		return self::OPTION_PREFIX . absint( $source_id ) . ( '' === $suffix ? '' : '_' . $suffix );
	}

	/**
	 * Whether a value is a 'HH:MM' time of day.
	 *
	 * @param mixed $value Candidate time.
	 * @return bool
	 */
	public static function valid_time( $value ) {
		return is_string( $value ) && 1 === preg_match( '/^([01]\d|2[0-3]):[0-5]\d$/', $value );
	}

	/**
	 * Where the reminder would go now: the collaborator's name and number,
	 * and whether sending to them is allowed.
	 *
	 * @param array $reminder Normalized reminder.
	 * @return array{status: string, name: string, digits: string} Status is
	 *     'ok', 'none' (no collaborator), 'directory_off', 'member_missing',
	 *     'no_number' or 'needs_confirmation'.
	 */
	public static function destination( array $reminder ) {
		$recipient = $reminder['recipient'];
		if ( ! $recipient ) {
			return self::destination_result( 'none' );
		}

		if ( self::KIND_MEMBER === $recipient['kind'] ) {
			if ( ! \FairEventsExperimental\Core\Plugin::team_members_available() ) {
				return self::destination_result( 'directory_off', $recipient['name'] );
			}
			$member = ( new \FairEventsExperimental\Models\TeamMemberRepository() )->find( $recipient['member_id'] );
			if ( ! $member ) {
				return self::destination_result( 'member_missing', $recipient['name'] );
			}
			$name   = self::member_name( $member );
			$digits = Client::normalize_recipient( (string) $member['phone'] );
		} else {
			$name   = $recipient['name'];
			$digits = $recipient['number'];
		}

		if ( '' === $digits ) {
			return self::destination_result( 'no_number', $name );
		}
		if ( ! self::consented( $reminder, $digits ) ) {
			return self::destination_result( 'needs_confirmation', $name, $digits );
		}
		return self::destination_result( 'ok', $name, $digits );
	}

	/**
	 * Whether consent was confirmed for this exact number.
	 *
	 * @param array  $reminder Normalized reminder.
	 * @param string $digits   Number in effect, digits only.
	 * @return bool
	 */
	public static function consented( array $reminder, $digits ) {
		$consent = $reminder['consent'];
		return is_array( $consent ) && '' !== $digits && hash_equals( self::fingerprint( $digits ), (string) $consent['fingerprint'] );
	}

	/**
	 * Consent record for a number, confirmed now by the current user.
	 *
	 * @param string $digits Number, digits only.
	 * @return array
	 */
	public static function consent_for( $digits ) {
		return array(
			'fingerprint'  => self::fingerprint( $digits ),
			'confirmed_at' => current_time( 'mysql', true ),
			'confirmed_by' => get_current_user_id(),
		);
	}

	/**
	 * A team member's display name.
	 *
	 * @param array $member Normalized team member profile.
	 * @return string
	 */
	public static function member_name( array $member ) {
		return trim( (string) $member['name'] . ' ' . (string) $member['surname'] );
	}

	/**
	 * Whether two links point at the same page, ignoring a trailing slash.
	 *
	 * @param string $a Link.
	 * @param string $b Link.
	 * @return bool
	 */
	public static function same_url( $a, $b ) {
		return '' !== (string) $a && untrailingslashit( (string) $a ) === untrailingslashit( (string) $b );
	}

	/**
	 * A reminder as stored: known fields with valid values only.
	 *
	 * @param array $raw Stored or submitted reminder.
	 * @return array
	 */
	public static function normalize( array $raw ) {
		$day  = (int) ( $raw['day_of_week'] ?? self::DEFAULTS['day_of_week'] );
		$time = (string) ( $raw['time_of_day'] ?? '' );

		return array(
			'enabled'     => ! empty( $raw['enabled'] ),
			'day_of_week' => $day >= 1 && $day <= 7 ? $day : self::DEFAULTS['day_of_week'],
			'time_of_day' => self::valid_time( $time ) ? $time : self::DEFAULTS['time_of_day'],
			'recipient'   => self::normalize_recipient( $raw['recipient'] ?? null ),
			'consent'     => self::normalize_consent( $raw['consent'] ?? null ),
			'template'    => self::normalize_template( $raw['template'] ?? null ),
		);
	}

	/**
	 * A stored collaborator, or null.
	 *
	 * @param mixed $raw Recipient fields.
	 * @return array|null
	 */
	private static function normalize_recipient( $raw ) {
		if ( ! is_array( $raw ) ) {
			return null;
		}
		$name = mb_substr( trim( sanitize_text_field( (string) ( $raw['name'] ?? '' ) ) ), 0, self::MAX_NAME_LENGTH );
		if ( self::KIND_MEMBER === ( $raw['kind'] ?? '' ) ) {
			$member_id = absint( $raw['member_id'] ?? 0 );
			return $member_id
				? array(
					'kind'      => self::KIND_MEMBER,
					'member_id' => $member_id,
					// Kept so a removed member can still be named.
					'name'      => $name,
					'number'    => '',
				)
				: null;
		}
		$number = Client::normalize_recipient( (string) ( $raw['number'] ?? '' ) );
		if ( self::KIND_STANDALONE !== ( $raw['kind'] ?? '' ) || '' === $name || '' === $number ) {
			return null;
		}
		return array(
			'kind'      => self::KIND_STANDALONE,
			'member_id' => 0,
			'name'      => $name,
			'number'    => $number,
		);
	}

	/**
	 * A stored consent record, or null.
	 *
	 * @param mixed $raw Consent fields.
	 * @return array|null
	 */
	private static function normalize_consent( $raw ) {
		if ( ! is_array( $raw ) || ! is_string( $raw['fingerprint'] ?? null ) || '' === $raw['fingerprint'] ) {
			return null;
		}
		return array(
			'fingerprint'  => $raw['fingerprint'],
			'confirmed_at' => (string) ( $raw['confirmed_at'] ?? '' ),
			'confirmed_by' => absint( $raw['confirmed_by'] ?? 0 ),
		);
	}

	/**
	 * A stored template choice, or null.
	 *
	 * @param mixed $raw Template fields.
	 * @return array|null
	 */
	private static function normalize_template( $raw ) {
		if ( ! is_array( $raw ) || ! Client::valid_template_name( $raw['name'] ?? null ) || ! Client::valid_language( $raw['language'] ?? null ) ) {
			return null;
		}
		return array(
			'name'     => $raw['name'],
			'language' => $raw['language'],
			'url'      => esc_url_raw( (string) ( $raw['url'] ?? '' ) ),
		);
	}

	/**
	 * Build a destination result.
	 *
	 * @param string $status Status.
	 * @param string $name   Collaborator name.
	 * @param string $digits Number, digits only.
	 * @return array{status: string, name: string, digits: string}
	 */
	private static function destination_result( $status, $name = '', $digits = '' ) {
		return array(
			'status' => $status,
			'name'   => (string) $name,
			'digits' => (string) $digits,
		);
	}

	/**
	 * A salted hash that tells numbers apart without storing a second copy.
	 *
	 * @param string $digits Number, digits only.
	 * @return string
	 */
	private static function fingerprint( $digits ) {
		return wp_hash( 'whatsapp-reminder-consent|' . $digits, 'auth' );
	}
}
