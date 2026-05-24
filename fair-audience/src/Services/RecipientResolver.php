<?php
/**
 * Recipient Resolver
 *
 * Single source of truth for turning a recipient filter
 * (`{labels, group_ids, is_marketing}`) into the list of recipients an email
 * send would target. Used by both the ad-hoc custom-mail flow and scheduled
 * event mailings so label/group/marketing logic lives in one place.
 *
 * @package FairAudience
 */

namespace FairAudience\Services;

use FairAudience\Database\EventParticipantRepository;
use FairAudience\Database\ParticipantRepository;
use FairAudience\Database\GroupParticipantRepository;
use FairAudience\Models\Participant;

defined( 'WPINC' ) || die;

/**
 * Resolves a recipient filter into recipient rows.
 */
class RecipientResolver {

	/**
	 * Event participant repository instance.
	 *
	 * @var EventParticipantRepository
	 */
	private $event_participant_repository;

	/**
	 * Participant repository instance.
	 *
	 * @var ParticipantRepository
	 */
	private $participant_repository;

	/**
	 * Group participant repository instance.
	 *
	 * @var GroupParticipantRepository
	 */
	private $group_participant_repository;

	/**
	 * Allowed participant labels for event-scoped sends.
	 *
	 * @var string[]
	 */
	const ALLOWED_LABELS = array( 'signed_up', 'collaborator', 'interested' );

	/**
	 * Constructor.
	 */
	public function __construct() {
		$this->event_participant_repository = new EventParticipantRepository();
		$this->participant_repository       = new ParticipantRepository();
		$this->group_participant_repository = new GroupParticipantRepository();
	}

	/**
	 * Normalize a raw recipient filter into a predictable shape.
	 *
	 * Accepts the `previewRecipients` payload / stored `recipients_filter` JSON
	 * and fills in defaults. Invalid labels are dropped.
	 *
	 * @param array $filter Raw filter array.
	 * @return array{labels: string[], group_ids: int[], is_marketing: bool}
	 */
	public function normalize_filter( $filter ) {
		$filter = is_array( $filter ) ? $filter : array();

		$labels = isset( $filter['labels'] ) ? (array) $filter['labels'] : array( 'signed_up', 'collaborator' );
		$labels = array_values( array_intersect( $labels, self::ALLOWED_LABELS ) );

		$group_ids = isset( $filter['group_ids'] ) ? array_map( 'absint', (array) $filter['group_ids'] ) : array();

		$is_marketing = ! isset( $filter['is_marketing'] ) || (bool) $filter['is_marketing'];

		return array(
			'labels'       => $labels,
			'group_ids'    => $group_ids,
			'is_marketing' => $is_marketing,
		);
	}

	/**
	 * Resolve a recipient filter into recipient rows.
	 *
	 * When `$event_id` is provided, recipients are the event participants whose
	 * label is in the filter; otherwise the whole audience is considered
	 * (labels do not apply). Group and marketing filters apply in both cases.
	 *
	 * @param array    $filter   Recipient filter (normalized or raw).
	 * @param int|null $event_id Event post ID, or null/0 for the whole audience.
	 * @return array[] Recipient rows: participant_id, name, surname, email,
	 *                 label, has_valid_email, would_skip_marketing.
	 */
	public function resolve( $filter, $event_id = null ) {
		$filter = $this->normalize_filter( $filter );

		if ( ! empty( $event_id ) ) {
			return $this->resolve_for_event( (int) $event_id, $filter );
		}

		return $this->resolve_for_audience( $filter );
	}

	/**
	 * Resolve a recipient filter scoped to a single event date.
	 *
	 * Recipients are the participants of that specific date whose label is in
	 * the filter; group and marketing filters apply as usual.
	 *
	 * @param array $filter        Recipient filter (normalized or raw).
	 * @param int   $event_date_id Event date ID.
	 * @return array[] Recipient rows.
	 */
	public function resolve_by_event_date( $filter, $event_date_id ) {
		$filter = $this->normalize_filter( $filter );

		return $this->resolve_for_event_date( (int) $event_date_id, $filter );
	}

	/**
	 * Resolve recipients scoped to a single event.
	 *
	 * @param int   $event_id Event post ID.
	 * @param array $filter   Normalized filter.
	 * @return array[] Recipient rows.
	 */
	private function resolve_for_event( $event_id, $filter ) {
		$recipients = array();

		if ( ! get_post( $event_id ) ) {
			return $recipients;
		}

		$event_participants = $this->event_participant_repository->get_by_event( $event_id );

		return $this->rows_from_event_participants( $event_participants, $filter );
	}

	/**
	 * Resolve recipients scoped to a single event date.
	 *
	 * @param int   $event_date_id Event date ID.
	 * @param array $filter        Normalized filter.
	 * @return array[] Recipient rows.
	 */
	private function resolve_for_event_date( $event_date_id, $filter ) {
		if ( empty( $event_date_id ) ) {
			return array();
		}

		$event_participants = $this->event_participant_repository->get_by_event_date( $event_date_id );

		return $this->rows_from_event_participants( $event_participants, $filter );
	}

	/**
	 * Build recipient rows from a set of event-participant relationships.
	 *
	 * @param object[] $event_participants Event-participant rows (have label, participant_id).
	 * @param array    $filter             Normalized filter.
	 * @return array[] Recipient rows.
	 */
	private function rows_from_event_participants( $event_participants, $filter ) {
		$recipients            = array();
		$group_participant_ids = $this->get_participant_ids_for_groups( $filter['group_ids'] );

		foreach ( $event_participants as $ep ) {
			if ( ! in_array( $ep->label, $filter['labels'], true ) ) {
				continue;
			}

			if ( ! empty( $filter['group_ids'] ) && ! in_array( $ep->participant_id, $group_participant_ids, true ) ) {
				continue;
			}

			$participant = $this->participant_repository->get_by_id( $ep->participant_id );
			if ( ! $participant ) {
				continue;
			}

			$recipients[] = $this->build_row( $participant, $ep->label, $filter['is_marketing'] );
		}

		return $recipients;
	}

	/**
	 * Resolve recipients across the whole audience (no event scope).
	 *
	 * @param array $filter Normalized filter.
	 * @return array[] Recipient rows.
	 */
	private function resolve_for_audience( $filter ) {
		$recipients            = array();
		$participants          = $this->participant_repository->get_all();
		$group_participant_ids = $this->get_participant_ids_for_groups( $filter['group_ids'] );

		foreach ( $participants as $participant ) {
			if ( ! empty( $filter['group_ids'] ) && ! in_array( $participant->id, $group_participant_ids, true ) ) {
				continue;
			}

			$recipients[] = $this->build_row( $participant, '', $filter['is_marketing'] );
		}

		return $recipients;
	}

	/**
	 * Build a single recipient row.
	 *
	 * @param Participant $participant  Participant object.
	 * @param string      $label        Event-participant label ('' for audience).
	 * @param bool        $is_marketing Whether the send is a marketing email.
	 * @return array Recipient row.
	 */
	private function build_row( Participant $participant, $label, $is_marketing ) {
		return array(
			'participant_id'       => $participant->id,
			'name'                 => $participant->name,
			'surname'              => $participant->surname,
			'email'                => $participant->email,
			'label'                => $label,
			'has_valid_email'      => $this->has_valid_email( $participant ),
			'would_skip_marketing' => $is_marketing && ! $this->can_receive_email( $participant, EmailType::MARKETING ),
		);
	}

	/**
	 * Check if a participant can receive a specific type of email.
	 *
	 * @param Participant $participant The participant to check.
	 * @param string      $email_type  EmailType::MINIMAL or EmailType::MARKETING.
	 * @return bool True if the participant can receive the email.
	 */
	public function can_receive_email( Participant $participant, string $email_type ): bool {
		if ( EmailType::MINIMAL === $email_type ) {
			return true;
		}

		return 'marketing' === $participant->email_profile;
	}

	/**
	 * Check if a participant has a valid email address.
	 *
	 * @param Participant $participant The participant to check.
	 * @return bool True if the participant has a non-empty email.
	 */
	public function has_valid_email( Participant $participant ): bool {
		return ! empty( $participant->email );
	}

	/**
	 * Get unique participant IDs for an array of group IDs.
	 *
	 * @param array $group_ids Array of group IDs.
	 * @return int[] Array of unique participant IDs.
	 */
	public function get_participant_ids_for_groups( $group_ids ) {
		if ( empty( $group_ids ) ) {
			return array();
		}

		$participant_ids = array();
		foreach ( $group_ids as $group_id ) {
			$members = $this->group_participant_repository->get_by_group( $group_id );
			foreach ( $members as $member ) {
				$participant_ids[] = $member->participant_id;
			}
		}

		return array_unique( $participant_ids );
	}
}
