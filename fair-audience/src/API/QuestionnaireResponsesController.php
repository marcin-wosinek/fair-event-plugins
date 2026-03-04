<?php
/**
 * Questionnaire Responses Controller
 *
 * @package FairAudience
 */

namespace FairAudience\API;

use FairAudience\Database\QuestionnaireSubmissionRepository;
use FairAudience\Database\QuestionnaireAnswerRepository;
use FairAudience\Database\ParticipantRepository;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * REST controller for questionnaire responses.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class QuestionnaireResponsesController extends WP_REST_Controller {

	/**
	 * Constructor.
	 */
	public function __construct() {
		$this->namespace = 'fair-audience/v1';
		$this->rest_base = 'questionnaire-responses';
	}

	/**
	 * Register routes.
	 */
	public function register_routes() {
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
					'args'                => array(
						'event_date_id' => array(
							'required'          => true,
							'type'              => 'integer',
							'sanitize_callback' => 'absint',
						),
					),
				),
			)
		);
	}

	/**
	 * Check permissions.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return bool|WP_Error True if allowed.
	 */
	public function get_items_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}

	/**
	 * Get questionnaire responses for an event date.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error Response.
	 */
	public function get_items( $request ) {
		$event_date_id = $request->get_param( 'event_date_id' );

		$submission_repo  = new QuestionnaireSubmissionRepository();
		$answer_repo      = new QuestionnaireAnswerRepository();
		$participant_repo = new ParticipantRepository();

		$submissions = $submission_repo->get_by_event_date( $event_date_id );

		$data = array();
		foreach ( $submissions as $submission ) {
			$participant = $participant_repo->get_by_id( $submission->participant_id );
			$answers     = $answer_repo->get_by_submission( $submission->id );

			$answers_data = array();
			foreach ( $answers as $answer ) {
				$answers_data[] = array(
					'question_key'  => $answer->question_key,
					'question_text' => $answer->question_text,
					'question_type' => $answer->question_type,
					'answer_value'  => $answer->answer_value,
				);
			}

			$participant_name  = '';
			$participant_email = '';
			if ( $participant ) {
				$participant_name  = trim( $participant->name . ' ' . $participant->surname );
				$participant_email = $participant->email;
			}

			$data[] = array(
				'id'                => $submission->id,
				'participant_name'  => $participant_name,
				'participant_email' => $participant_email,
				'created_at'        => $submission->created_at,
				'answers'           => $answers_data,
			);
		}

		return new WP_REST_Response( $data, 200 );
	}
}
