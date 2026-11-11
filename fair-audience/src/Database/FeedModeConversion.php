<?php
/**
 * Feed mode conversion
 *
 * @package FairAudience
 */

namespace FairAudience\Database;

use FairAudience\Services\LegacyFeedPreferences;
use FairAudience\Services\WeeklyFeeds;

defined( 'WPINC' ) || die;

/**
 * One-time conversion of the legacy "all weekly emails" feed mode into
 * explicit feed subscriptions (#2239).
 *
 * Same-site upgrade only. Participants who were receiving every weekly
 * email are subscribed to the feeds that were eligible when the conversion
 * started; those who were not receiving it get no feeds. Existing explicit
 * subscriptions, consent, confirmation and the weekly opt-out are left as
 * they are.
 *
 * The eligible feeds are read once and stored before anyone is converted,
 * so a retry or a later batch never adds a feed created in between. Each
 * participant's feeds and mode change in one transaction; a converted
 * participant is never processed again. When the feed list cannot be read
 * the conversion waits and reports itself unfinished; it never treats a
 * failed read as "no feeds". A cross-site CSV import must never use this
 * class: see {@see \FairAudience\Services\LegacyFeedPreferences::for_import()}.
 */
class FeedModeConversion {

	/**
	 * Option holding the eligible feed IDs read when the conversion started.
	 */
	const SNAPSHOT_OPTION = 'fair_audience_feed_mode_conversion_snapshot';

	/**
	 * Participants converted per request.
	 */
	const BATCH_SIZE = 200;

	/**
	 * Reads the eligible feeds; returns null when they cannot be read.
	 *
	 * @var callable
	 */
	private $read_feeds;

	/**
	 * Legacy participant storage.
	 *
	 * @var LegacyFeedModeRepository|object
	 */
	private $store;

	/**
	 * Constructor.
	 *
	 * @param callable|null $read_feeds Returns eligible feed IDs, or null when they cannot be read.
	 * @param object|null   $store      Legacy participant storage, for tests.
	 */
	public function __construct( ?callable $read_feeds = null, $store = null ) {
		$this->read_feeds = $read_feeds ?? array( self::class, 'read_eligible_feeds' );
		$this->store      = $store ?? new LegacyFeedModeRepository();
	}

	/**
	 * Convert the next batch with the site's own feeds and storage.
	 *
	 * @return bool Whether every participant is converted.
	 */
	public static function run(): bool {
		return ( new self() )->convert();
	}

	/**
	 * Convert the next batch of legacy participants.
	 *
	 * @return bool Whether every participant is converted, so the upgrade can be recorded.
	 */
	public function convert(): bool {
		if ( ! $this->store->has_legacy() ) {
			delete_option( self::SNAPSHOT_OPTION );
			return true;
		}

		$snapshot = $this->snapshot();
		if ( null === $snapshot ) {
			return false;
		}

		foreach ( $this->store->legacy_batch( self::BATCH_SIZE ) as $participant ) {
			$feed_ids = LegacyFeedPreferences::for_same_site_upgrade( $participant, $snapshot );
			if ( ! $this->store->convert( (int) $participant['id'], $feed_ids ) ) {
				return false;
			}
		}

		if ( $this->store->has_legacy() ) {
			return false;
		}

		delete_option( self::SNAPSHOT_OPTION );
		return true;
	}

	/**
	 * The stored snapshot, taken now when none is stored yet.
	 *
	 * @return int[]|null Eligible feed IDs; null while they cannot be read or stored.
	 */
	private function snapshot() {
		$stored = get_option( self::SNAPSHOT_OPTION, null );
		if ( is_array( $stored ) && isset( $stored['feed_ids'] ) && is_array( $stored['feed_ids'] ) ) {
			return array_values( array_map( 'intval', $stored['feed_ids'] ) );
		}

		$feed_ids = call_user_func( $this->read_feeds );
		if ( ! is_array( $feed_ids ) ) {
			return null;
		}

		$feed_ids = array_values( array_unique( array_filter( array_map( 'intval', $feed_ids ) ) ) );
		sort( $feed_ids );

		if ( ! update_option( self::SNAPSHOT_OPTION, array( 'feed_ids' => $feed_ids ), false ) ) {
			// Stored already with the same value counts; anything else waits.
			$reread = get_option( self::SNAPSHOT_OPTION, null );
			if ( ! is_array( $reread ) || ( $reread['feed_ids'] ?? null ) !== $feed_ids ) {
				return null;
			}
		}

		return $feed_ids;
	}

	/**
	 * Whether a legacy participant was receiving the weekly email: the
	 * consent, confirmation and opt-out rules it was sent under.
	 *
	 * @param array $participant Row with email_profile, status and weekly_summary_opt_out.
	 * @return bool
	 */
	public static function was_receiving( array $participant ): bool {
		return 'marketing' === ( $participant['email_profile'] ?? '' )
			&& 'confirmed' === ( $participant['status'] ?? '' )
			&& empty( $participant['weekly_summary_opt_out'] );
	}

	/**
	 * Feeds eligible for delivery now, as subscribers can choose them.
	 *
	 * @return int[]|null Feed IDs; null when Fair Events cannot list them.
	 */
	public static function read_eligible_feeds() {
		$feeds = new WeeklyFeeds( null, new ParticipantFeedRepository() );
		if ( ! $feeds->is_available() ) {
			return null;
		}

		try {
			return array_column( $feeds->subscribable(), 'id' );
		} catch ( \Throwable $e ) {
			return null;
		}
	}
}
