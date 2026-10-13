<?php
/**
 * Manage Subscription Page
 *
 * Processes requests to the public subscription-management page.
 *
 * @package FairAudience
 */

namespace FairAudience\Services;

use FairAudience\Database\ParticipantCategoryRepository;
use FairAudience\Database\ParticipantRepository;

defined( 'WPINC' ) || die;

/**
 * Decides what the subscription-management page shows and changes.
 *
 * The signed link authorizes the visitor. Deleting personal data takes two
 * requests: one that opens the confirmation and one that carries the
 * confirmation proof issued with it.
 */
class ManageSubscriptionPage {

	const VIEW_INVALID        = 'invalid';
	const VIEW_MANAGE         = 'manage';
	const VIEW_CONFIRM_DELETE = 'confirm_delete';
	const VIEW_DELETED        = 'deleted';

	/**
	 * Seconds a confirmation proof stays valid after the page is rendered.
	 */
	const PROOF_LIFETIME = 86400;

	/**
	 * Looks up a participant by ID.
	 *
	 * @var callable
	 */
	private $find_participant;

	/**
	 * Anonymizes a participant and reports success.
	 *
	 * @var callable
	 */
	private $anonymize;

	/**
	 * Constructor.
	 *
	 * @param callable|null $find_participant Participant lookup by ID; defaults to the repository.
	 * @param callable|null $anonymize        Anonymization of a participant; defaults to the service.
	 */
	public function __construct( ?callable $find_participant = null, ?callable $anonymize = null ) {
		$this->find_participant = $find_participant ?? static function ( $participant_id ) {
			return ( new ParticipantRepository() )->get_by_id( $participant_id );
		};
		$this->anonymize        = $anonymize ?? array( ParticipantAnonymizationService::class, 'anonymize' );
	}

	/**
	 * Process a request to the page.
	 *
	 * @param string $token Token from the signed link.
	 * @param array  $post  Unslashed POST fields; empty for a plain page view.
	 * @return array {
	 *     @type string      $view               One of the VIEW_* constants.
	 *     @type int         $status             HTTP status to answer with.
	 *     @type string|null $redirect           URL to redirect to instead of rendering.
	 *     @type object|null $participant        Authorized participant.
	 *     @type string      $message            Notice to show, if any.
	 *     @type string      $message_type       'success' or 'error'.
	 *     @type string      $confirmation_proof Proof the confirmed deletion must carry.
	 * }
	 */
	public function handle( string $token, array $post = array() ): array {
		$page = array(
			'view'               => self::VIEW_INVALID,
			'status'             => 200,
			'redirect'           => null,
			'participant'        => null,
			'message'            => '',
			'message_type'       => 'error',
			'confirmation_proof' => '',
		);

		$participant_id = ManageSubscriptionToken::verify( $token );

		if ( false === $participant_id ) {
			$page['message'] = __( 'Invalid or expired link. Please use the link from your email.', 'fair-audience' );
			return $page;
		}

		$participant = call_user_func( $this->find_participant, $participant_id );

		if ( ! $participant ) {
			$page['message'] = __( 'Subscriber not found.', 'fair-audience' );
			return $page;
		}

		$page['participant'] = $participant;
		$wants_deletion      = isset( $post['delete_my_data'] ) || isset( $post['confirm_delete_my_data'] );

		if ( self::is_anonymized( $participant ) ) {
			// A repeated deletion request lands on the same answer as the first.
			if ( $wants_deletion ) {
				$page['redirect'] = ManageSubscriptionToken::get_url( $participant_id );
				return $page;
			}

			$page['view']         = self::VIEW_DELETED;
			$page['message']      = __( 'Your personal data has been deleted from your profile. Records such as tickets, event attendance, consent history and payments were kept.', 'fair-audience' );
			$page['message_type'] = 'success';
			return $page;
		}

		$page['view']               = self::VIEW_MANAGE;
		$page['confirmation_proof'] = self::issue_confirmation_proof( $participant_id );

		if ( isset( $post['confirm_delete_my_data'] ) ) {
			return $this->delete_data( $page, $participant_id, $post );
		}

		if ( isset( $post['delete_my_data'] ) ) {
			$page['view'] = self::VIEW_CONFIRM_DELETE;
			return $page;
		}

		if ( isset( $post['email_profile'] ) ) {
			return $this->save_preferences( $page, $post );
		}

		return $page;
	}

	/**
	 * Delete the participant's data when the request carries a valid proof.
	 *
	 * @param array $page           Page state so far.
	 * @param int   $participant_id Authorized participant ID.
	 * @param array $post           Unslashed POST fields.
	 * @return array Page state.
	 */
	private function delete_data( array $page, int $participant_id, array $post ): array {
		$proof = isset( $post['delete_confirmation'] ) && is_string( $post['delete_confirmation'] )
			? sanitize_text_field( $post['delete_confirmation'] )
			: '';

		if ( ! self::verify_confirmation_proof( $proof, $participant_id ) ) {
			$page['status']  = 400;
			$page['message'] = __( 'Your data was not deleted because the confirmation was missing or has expired. Please try again.', 'fair-audience' );
			return $page;
		}

		if ( ! call_user_func( $this->anonymize, $page['participant'] ) ) {
			$page['status']  = 500;
			$page['message'] = __( 'Your data could not be deleted and nothing was changed. Please try again.', 'fair-audience' );
			return $page;
		}

		// Redirect so a browser refresh cannot send the deletion again.
		$page['redirect'] = ManageSubscriptionToken::get_url( $participant_id );
		return $page;
	}

	/**
	 * Save the email preferences form.
	 *
	 * @param array $page Page state so far.
	 * @param array $post Unslashed POST fields.
	 * @return array Page state.
	 */
	private function save_preferences( array $page, array $post ): array {
		$participant = $page['participant'];
		$new_profile = is_string( $post['email_profile'] ) ? sanitize_text_field( $post['email_profile'] ) : '';

		if ( ! in_array( $new_profile, array( 'minimal', 'marketing' ), true ) ) {
			return $page;
		}

		$participant->email_profile = $new_profile;

		if ( WeeklyDigestMailer::is_enabled() && 'marketing' === $new_profile ) {
			$participant->weekly_summary_opt_out = isset( $post['weekly_summary'] ) ? 0 : 1;
		}

		if ( ! $participant->save() ) {
			$page['message'] = __( 'Failed to update preferences. Please try again.', 'fair-audience' );
			return $page;
		}

		$selected_cats = isset( $post['mailing_categories'] ) ? array_map( 'absint', (array) $post['mailing_categories'] ) : array();
		( new ParticipantCategoryRepository() )->set_categories( $participant->id, $selected_cats );

		$page['message']      = __( 'Your preferences have been updated.', 'fair-audience' );
		$page['message_type'] = 'success';
		return $page;
	}

	/**
	 * Whether the profile's personal data was already deleted.
	 *
	 * @param object $participant Participant.
	 * @return bool
	 */
	public static function is_anonymized( $participant ): bool {
		return 'Deleted' === $participant->name && '' === (string) $participant->email;
	}

	/**
	 * What deleting personal data from this page changes and what it keeps.
	 *
	 * Mirrors ParticipantAnonymizationService::anonymize(), including which
	 * integrations it reaches.
	 *
	 * @return array {
	 *     @type string[] $changed Sentences about data that is deleted or cleared.
	 *     @type string[] $kept    Sentences about records that stay.
	 * }
	 */
	public static function deletion_scope(): array {
		$changed = array(
			__( 'Your name, email address, phone number and Instagram handle are deleted from your profile.', 'fair-audience' ),
			__( 'Your email preferences and pending confirmation links are deleted.', 'fair-audience' ),
		);

		if ( class_exists( '\FairForm\Database\QuestionnaireSubmissionRepository' ) ) {
			$changed[] = __( 'Your questionnaire answers are deleted.', 'fair-audience' );
		}
		if ( class_exists( '\FairAudienceExperimental\Database\PollAccessKeyRepository' ) ) {
			$changed[] = __( 'Your poll responses and poll links are deleted.', 'fair-audience' );
		}
		if ( class_exists( '\FairAudienceExperimental\Database\GroupParticipantRepository' ) ) {
			$changed[] = __( 'Your group memberships are deleted.', 'fair-audience' );
		}

		$kept = array();

		if ( class_exists( '\FairEvents\Models\EventSignup' )
			&& method_exists( '\FairEvents\Models\EventSignup', 'anonymize_by_participant_id' )
		) {
			$changed[] = __( 'Your name and email address are deleted from your event signups.', 'fair-audience' );
			$kept[]    = __( 'Your event signups and tickets are kept, but are no longer connected to your profile.', 'fair-audience' );
		}

		$kept[] = __( 'Records of the events you took part in, your consent history and payment records are kept and may still contain your details.', 'fair-audience' );
		$kept[] = __( 'If you have a user account on this site, it is disconnected from your profile but not deleted.', 'fair-audience' );

		return array(
			'changed' => $changed,
			'kept'    => $kept,
		);
	}

	/**
	 * Issue the proof a confirmed deletion must carry.
	 *
	 * @param int      $participant_id Participant the proof is bound to.
	 * @param int|null $now            Current Unix time; defaults to time().
	 * @return string Proof.
	 */
	public static function issue_confirmation_proof( int $participant_id, ?int $now = null ): string {
		$expires = ( $now ?? time() ) + self::PROOF_LIFETIME;

		return $expires . '.' . self::sign_proof( $participant_id, $expires );
	}

	/**
	 * Check a confirmation proof against the authorized participant.
	 *
	 * @param string   $proof          Submitted proof.
	 * @param int      $participant_id Participant authorized by the signed link.
	 * @param int|null $now            Current Unix time; defaults to time().
	 * @return bool Whether the proof was issued for this participant and has not expired.
	 */
	public static function verify_confirmation_proof( string $proof, int $participant_id, ?int $now = null ): bool {
		$parts = explode( '.', $proof, 2 );

		if ( 2 !== count( $parts ) || ! ctype_digit( $parts[0] ) ) {
			return false;
		}

		$expires = (int) $parts[0];

		if ( $expires < ( $now ?? time() ) ) {
			return false;
		}

		return hash_equals( self::sign_proof( $participant_id, $expires ), $parts[1] );
	}

	/**
	 * Sign a proof's participant and expiry with HMAC-SHA256.
	 *
	 * @param int $participant_id Participant ID.
	 * @param int $expires        Expiry as Unix time.
	 * @return string Hex-encoded signature.
	 */
	private static function sign_proof( int $participant_id, int $expires ): string {
		$secret = 'fair_audience_delete_confirmation_' . wp_salt( 'auth' );

		return hash_hmac( 'sha256', $participant_id . '|' . $expires, $secret );
	}
}
