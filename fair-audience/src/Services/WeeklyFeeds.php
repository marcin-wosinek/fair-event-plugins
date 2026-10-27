<?php
/**
 * Weekly Feeds
 *
 * @package FairAudience
 */

namespace FairAudience\Services;

use FairAudience\Database\ParticipantFeedRepository;
use FairAudience\Models\Participant;

defined( 'WPINC' ) || die;

/**
 * Which weekly email feeds a subscriber can choose, and which one a
 * submitted choice may store.
 *
 * Feeds come from Fair Events ({@see \FairEvents\Notifications\WeeklyFeedCatalog})
 * and are identified by their numeric ID. A participant in the 'all' mode
 * receives every weekly email, including feeds added later; in the
 * 'selected' mode, only the feeds they chose, and none when they chose none.
 * A feed that is unavailable for now stays selected, so it comes back when
 * the feed is turned on again, but is never replaced by another feed.
 */
class WeeklyFeeds {

	const MODE_ALL      = 'all';
	const MODE_SELECTED = 'selected';

	/**
	 * Fair Events' feed catalog, or null while Fair Events cannot provide it.
	 *
	 * @var object|null
	 */
	private $catalog;

	/**
	 * Participant weekly-feed repository.
	 *
	 * @var ParticipantFeedRepository|object
	 */
	private $feed_repository;

	/**
	 * Constructor.
	 *
	 * @param object|false|null $catalog         Catalog with subscribable() and describe(); null for
	 *                                           Fair Events', false for none.
	 * @param object|null       $feed_repository Participant weekly-feed repository.
	 */
	public function __construct( $catalog = null, $feed_repository = null ) {
		$this->catalog         = null === $catalog ? self::fair_events_catalog() : ( $catalog ? $catalog : null );
		$this->feed_repository = $feed_repository ?? new ParticipantFeedRepository();
	}

	/**
	 * Fair Events' catalog, when an active Fair Events provides one.
	 *
	 * @return object|null
	 */
	private static function fair_events_catalog() {
		$class = '\FairEvents\Notifications\WeeklyFeedCatalog';

		return class_exists( $class ) && method_exists( $class, 'subscribable' ) && method_exists( $class, 'describe' )
			? new $class()
			: null;
	}

	/**
	 * Whether feeds can be listed and chosen on this request.
	 *
	 * @return bool
	 */
	public function is_available(): bool {
		return null !== $this->catalog;
	}

	/**
	 * Feeds a subscriber can choose now.
	 *
	 * @return array[] Each with `id` and `name`; empty while Fair Events cannot list them.
	 */
	public function subscribable(): array {
		return $this->catalog ? $this->catalog->subscribable() : array();
	}

	/**
	 * Names of chosen feeds that cannot be chosen now but still exist.
	 *
	 * @param int[] $feed_ids Chosen feed IDs.
	 * @return array{unavailable: array[], deleted: int} Feeds that still
	 *     exist, with `id` and `name`, and how many no longer exist.
	 */
	public function unavailable( array $feed_ids ): array {
		$offered = array_column( $this->subscribable(), 'id' );
		$missing = array_values( array_diff( array_map( 'intval', $feed_ids ), $offered ) );
		$known   = $this->catalog && $missing ? $this->catalog->describe( $missing ) : array();

		return array(
			'unavailable' => $known,
			'deleted'     => $this->catalog ? count( $missing ) - count( $known ) : 0,
		);
	}

	/**
	 * Check a submitted selection and work out what to store.
	 *
	 * Every submitted feed must be one that can be chosen now. Stored feeds
	 * that cannot be chosen now are kept, because the subscriber could not
	 * see or change them.
	 *
	 * @param mixed $submitted Submitted feed IDs.
	 * @param int[] $stored    Feed IDs stored so far.
	 * @return int[]|\WP_Error Feed IDs to store, or an error when the selection cannot be accepted.
	 */
	public function resolve_selection( $submitted, array $stored = array() ) {
		if ( ! $this->is_available() ) {
			return new \WP_Error( 'weekly_feeds_unavailable', __( 'Event feeds cannot be chosen right now. Please try again later.', 'fair-audience' ), array( 'status' => 503 ) );
		}

		if ( ! is_array( $submitted ) ) {
			return new \WP_Error( 'invalid_weekly_feeds', __( 'One of the chosen event feeds is not available. Please review your choice and try again.', 'fair-audience' ), array( 'status' => 400 ) );
		}

		$offered = array_column( $this->subscribable(), 'id' );
		$chosen  = array();
		foreach ( $submitted as $value ) {
			$id = is_numeric( $value ) ? (int) $value : 0;
			if ( (string) $id !== (string) $value || ! in_array( $id, $offered, true ) ) {
				return new \WP_Error( 'invalid_weekly_feeds', __( 'One of the chosen event feeds is not available. Please review your choice and try again.', 'fair-audience' ), array( 'status' => 400 ) );
			}
			$chosen[] = $id;
		}

		$kept = array_diff( array_map( 'intval', $stored ), $offered );
		$ids  = array_values( array_unique( array_merge( $chosen, $kept ) ) );
		sort( $ids );

		return $ids;
	}

	/**
	 * Feed IDs a participant chose.
	 *
	 * @param int $participant_id Participant ID.
	 * @return int[]
	 */
	public function selected( int $participant_id ): array {
		return $this->feed_repository->get_feed_ids_by_participant( $participant_id );
	}

	/**
	 * Apply weekly email preferences to a participant whose identity is
	 * already trusted.
	 *
	 * A key that is absent leaves that preference unchanged. Choosing feeds
	 * switches the participant to the 'selected' mode, also with no feeds,
	 * and never clears the weekly opt-out.
	 *
	 * @param Participant $participant Participant; saved when a preference changes.
	 * @param array       $preferences `weekly_summary` (bool) and/or `feed_ids` (int[]).
	 * @param bool        $strict      True to reject a feed that cannot be chosen now; false to
	 *                                 leave such feeds out (for preferences checked earlier).
	 * @return true|\WP_Error
	 */
	public function apply( Participant $participant, array $preferences, bool $strict = true ) {
		$feed_ids = null;
		if ( array_key_exists( 'feed_ids', $preferences ) ) {
			$stored   = $this->selected( (int) $participant->id );
			$feed_ids = $strict
				? $this->resolve_selection( $preferences['feed_ids'], $stored )
				: $this->narrow_selection( (array) $preferences['feed_ids'], $stored );
			if ( is_wp_error( $feed_ids ) ) {
				return $feed_ids;
			}
		}

		if ( null !== $feed_ids ) {
			if ( ! $this->feed_repository->set_feeds( (int) $participant->id, $feed_ids ) ) {
				return self::save_error();
			}
			$participant->weekly_feed_mode = self::MODE_SELECTED;
		}

		if ( array_key_exists( 'weekly_summary', $preferences ) ) {
			$participant->weekly_summary_opt_out = $preferences['weekly_summary'] ? 0 : 1;
		}

		if ( ( null !== $feed_ids || array_key_exists( 'weekly_summary', $preferences ) ) && ! $participant->save() ) {
			return self::save_error();
		}

		return true;
	}

	/**
	 * Keep the submitted feeds that can still be chosen, plus stored feeds
	 * that cannot be chosen now. Never adds a feed.
	 *
	 * Without Fair Events' catalog the submitted feeds are kept as they are:
	 * they were checked when submitted, and dropping them all would widen
	 * the choice to every feed.
	 *
	 * @param int[] $submitted Feed IDs checked earlier.
	 * @param int[] $stored    Feed IDs stored so far.
	 * @return int[]
	 */
	private function narrow_selection( array $submitted, array $stored ): array {
		$submitted = array_map( 'intval', $submitted );
		if ( $this->is_available() ) {
			$offered   = array_column( $this->subscribable(), 'id' );
			$submitted = array_merge( array_intersect( $submitted, $offered ), array_diff( array_map( 'intval', $stored ), $offered ) );
		}
		$ids = array_values( array_unique( array_filter( $submitted ) ) );
		sort( $ids );

		return $ids;
	}

	/**
	 * Error for preferences that could not be stored.
	 *
	 * @return \WP_Error
	 */
	private static function save_error(): \WP_Error {
		return new \WP_Error( 'preferences_not_saved', __( 'Failed to update preferences. Please try again.', 'fair-audience' ), array( 'status' => 500 ) );
	}

	/**
	 * Whether a feed's weekly email is meant for a participant.
	 *
	 * Consent and the weekly opt-out are checked separately
	 * ({@see RecipientResolver::can_receive_email()}).
	 *
	 * @param Participant $participant    Participant.
	 * @param int         $feed_id        Feed the email lists; 0 when the sender cannot say.
	 * @param int[]       $subscriber_ids IDs of the participants who chose that feed.
	 * @return bool Always for the 'all' mode; for chosen feeds, only when
	 *     this feed is one of them.
	 */
	public static function in_scope( Participant $participant, int $feed_id, array $subscriber_ids ): bool {
		if ( self::MODE_SELECTED !== $participant->weekly_feed_mode ) {
			return true;
		}

		return $feed_id > 0 && in_array( (int) $participant->id, $subscriber_ids, true );
	}
}
