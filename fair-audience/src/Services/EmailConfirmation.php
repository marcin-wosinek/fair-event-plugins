<?php
/**
 * Email Confirmation
 *
 * @package FairAudience
 */

namespace FairAudience\Services;

use FairAudience\Database\EmailConfirmationTokenRepository;
use FairAudience\Database\ParticipantCategoryRepository;
use FairAudience\Database\ParticipantRepository;

defined( 'WPINC' ) || die;

/**
 * Confirms a mailing-list signup from the token its confirmation email
 * carries, for both the REST endpoint and the emailed link's page.
 *
 * The weekly preferences and announcement categories submitted with the
 * signup apply here. The token is used up only once everything is stored,
 * so a failure leaves the link working for another try.
 */
class EmailConfirmation {

	const CONFIRMED             = 'confirmed';
	const ALREADY_CONFIRMED     = 'already_confirmed';
	const INVALID_TOKEN         = 'invalid_token';
	const TOKEN_EXPIRED         = 'token_expired';
	const PARTICIPANT_NOT_FOUND = 'participant_not_found';
	const UPDATE_FAILED         = 'update_failed';

	/**
	 * Prefix of the transient holding a signup's pending category IDs.
	 */
	const PENDING_CATEGORIES_PREFIX = 'fair_audience_pending_cats_';

	/**
	 * Token lookup by token string.
	 *
	 * @var callable
	 */
	private $find_token;

	/**
	 * Participant lookup by ID.
	 *
	 * @var callable
	 */
	private $find_participant;

	/**
	 * Weekly email feeds, created when first needed.
	 *
	 * @var WeeklyFeeds|null
	 */
	private $weekly_feeds;

	/**
	 * Participant category repository, created when first needed.
	 *
	 * @var ParticipantCategoryRepository|object|null
	 */
	private $categories;

	/**
	 * Starts the confirmed participant's audience session.
	 *
	 * @var callable
	 */
	private $start_session;

	/**
	 * Constructor.
	 *
	 * @param callable|null    $find_token       Token lookup by token string; defaults to the repository.
	 * @param callable|null    $find_participant Participant lookup by ID; defaults to the repository.
	 * @param WeeklyFeeds|null $weekly_feeds     Weekly email feeds; defaults to Fair Events' feeds.
	 * @param object|null      $categories       Participant category repository.
	 * @param callable|null    $start_session    Audience session start; defaults to AudienceSession::set().
	 */
	public function __construct( ?callable $find_token = null, ?callable $find_participant = null, ?WeeklyFeeds $weekly_feeds = null, $categories = null, ?callable $start_session = null ) {
		$this->find_token       = $find_token ?? static function ( $token ) {
			return ( new EmailConfirmationTokenRepository() )->get_by_token( $token );
		};
		$this->find_participant = $find_participant ?? static function ( $participant_id ) {
			return ( new ParticipantRepository() )->get_by_id( $participant_id );
		};
		$this->weekly_feeds     = $weekly_feeds;
		$this->categories       = $categories;
		$this->start_session    = $start_session ?? array( AudienceSession::class, 'set' );
	}

	/**
	 * Confirm the signup a token belongs to.
	 *
	 * A participant confirmed some other way still gets the preferences
	 * submitted with the token: the link proves they own the address. It
	 * counts as already confirmed only when the link brought nothing new.
	 *
	 * @param string $token Token from the confirmation link.
	 * @return string One of the outcome constants.
	 */
	public function confirm( string $token ): string {
		$confirmation = '' === $token ? null : call_user_func( $this->find_token, $token );

		if ( ! $confirmation ) {
			return self::INVALID_TOKEN;
		}

		if ( $confirmation->is_expired() ) {
			$confirmation->delete();
			return self::TOKEN_EXPIRED;
		}

		$participant = call_user_func( $this->find_participant, $confirmation->participant_id );

		if ( ! $participant ) {
			// Clean up the orphaned token.
			$confirmation->delete();
			return self::PARTICIPANT_NOT_FOUND;
		}

		$transient_key      = self::PENDING_CATEGORIES_PREFIX . $participant->id;
		$pending_categories = get_transient( $transient_key );
		$pending_categories = is_array( $pending_categories ) ? $pending_categories : array();
		$was_subscribed     = 'confirmed' === $participant->status && 'marketing' === $participant->email_profile
			&& ! is_array( $confirmation->pending_preferences ) && empty( $pending_categories );

		// Feeds that cannot be chosen any more are left out; none is added.
		if ( is_array( $confirmation->pending_preferences ) ) {
			$applied = $this->weekly_feeds()->apply( $participant, $confirmation->pending_preferences, false );
			if ( is_wp_error( $applied ) ) {
				return self::UPDATE_FAILED;
			}
		}

		$participant->status        = 'confirmed';
		$participant->email_profile = 'marketing';

		if ( ! $participant->save() ) {
			return self::UPDATE_FAILED;
		}

		if ( ! empty( $pending_categories ) ) {
			if ( ! $this->categories()->set_categories( $participant->id, $pending_categories ) ) {
				return self::UPDATE_FAILED;
			}
			delete_transient( $transient_key );
		}

		// One-time use.
		$confirmation->delete();

		call_user_func( $this->start_session, (int) $participant->id );

		return $was_subscribed ? self::ALREADY_CONFIRMED : self::CONFIRMED;
	}

	/**
	 * Weekly email feeds, created when first needed.
	 *
	 * @return WeeklyFeeds
	 */
	private function weekly_feeds(): WeeklyFeeds {
		if ( null === $this->weekly_feeds ) {
			$this->weekly_feeds = new WeeklyFeeds();
		}

		return $this->weekly_feeds;
	}

	/**
	 * Participant category repository, created when first needed.
	 *
	 * @return ParticipantCategoryRepository|object
	 */
	private function categories() {
		if ( null === $this->categories ) {
			$this->categories = new ParticipantCategoryRepository();
		}

		return $this->categories;
	}
}
