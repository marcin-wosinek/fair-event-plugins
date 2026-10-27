<?php
/**
 * In-memory participant weekly-feed repository.
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Services\Fakes;

/**
 * Holds feeds per participant.
 */
class FakeParticipantFeedRepository {

	/**
	 * Feed IDs by participant ID.
	 *
	 * @var array<int, int[]>
	 */
	public $feeds = array();

	/**
	 * Whether storing fails.
	 *
	 * @var bool
	 */
	public $fails = false;

	/**
	 * Feeds of a participant.
	 *
	 * @param int $participant_id Participant ID.
	 * @return int[]
	 */
	public function get_feed_ids_by_participant( $participant_id ) {
		return $this->feeds[ $participant_id ] ?? array();
	}

	/**
	 * Participants who chose a feed.
	 *
	 * @param int $feed_id Feed ID.
	 * @return int[]
	 */
	public function get_participant_ids_by_feed( $feed_id ) {
		$ids = array();
		foreach ( $this->feeds as $participant_id => $feed_ids ) {
			if ( in_array( $feed_id, $feed_ids, true ) ) {
				$ids[] = $participant_id;
			}
		}
		return $ids;
	}

	/**
	 * Replace a participant's feeds.
	 *
	 * @param int   $participant_id Participant ID.
	 * @param int[] $feed_ids       Feed IDs.
	 * @return bool
	 */
	public function set_feeds( $participant_id, array $feed_ids ) {
		if ( $this->fails ) {
			return false;
		}
		$this->feeds[ $participant_id ] = array_values( $feed_ids );
		return true;
	}
}
