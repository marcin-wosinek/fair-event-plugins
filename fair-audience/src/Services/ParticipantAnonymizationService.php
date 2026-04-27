<?php
/**
 * Participant Anonymization Service
 *
 * @package FairAudience
 */

namespace FairAudience\Services;

use FairAudience\Models\Participant;
use FairAudience\Database\EmailConfirmationTokenRepository;
use FairAudience\Database\ParticipantCategoryRepository;
use FairAudience\Database\QuestionnaireSubmissionRepository;
use FairAudience\Database\GalleryAccessKeyRepository;
use FairAudience\Database\PollAccessKeyRepository;
use FairAudience\Database\PollResponseRepository;
use FairAudience\Database\GroupParticipantRepository;

defined( 'WPINC' ) || die;

/**
 * Handles anonymization of participant data (GDPR data deletion).
 */
class ParticipantAnonymizationService {

	/**
	 * Anonymize a participant's personal data and clean up related records.
	 *
	 * @param Participant $participant Participant to anonymize.
	 * @return bool Success.
	 */
	public static function anonymize( Participant $participant ) {
		if ( ! $participant->id ) {
			return false;
		}

		$success = $participant->anonymize();

		if ( ! $success ) {
			return false;
		}

		$id = $participant->id;

		( new EmailConfirmationTokenRepository() )->delete_by_participant_id( $id );
		( new ParticipantCategoryRepository() )->delete_by_participant( $id );
		( new QuestionnaireSubmissionRepository() )->delete_by_participant( $id );
		( new GalleryAccessKeyRepository() )->delete_by_participant( $id );
		( new PollAccessKeyRepository() )->delete_by_participant( $id );
		( new PollResponseRepository() )->delete_all_by_participant( $id );
		( new GroupParticipantRepository() )->delete_by_participant( $id );

		return true;
	}
}
