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
use FairAudience\Database\ParticipantCategoryRepository;
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
						'post_id'       => array(
							'required'          => false,
							'type'              => 'integer',
							'sanitize_callback' => 'absint',
						),
						'title'         => array(
							'required'          => false,
							'type'              => 'string',
							'sanitize_callback' => 'sanitize_text_field',
						),
					),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/forms-summary',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_forms_summary' ),
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

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/all',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_all_items' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<id>\d+)',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_item' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
				),
				array(
					'methods'             => WP_REST_Server::EDITABLE,
					'callback'            => array( $this, 'update_item' ),
					'permission_callback' => array( $this, 'delete_item_permissions_check' ),
					'args'                => array(
						'event_date_id' => array(
							'type'              => 'integer',
							'sanitize_callback' => 'absint',
						),
					),
				),
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'delete_item' ),
					'permission_callback' => array( $this, 'delete_item_permissions_check' ),
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
		$post_id       = $request->get_param( 'post_id' );
		$title         = $request->get_param( 'title' );

		$submission_repo  = new QuestionnaireSubmissionRepository();
		$answer_repo      = new QuestionnaireAnswerRepository();
		$participant_repo = new ParticipantRepository();
		$category_repo    = new ParticipantCategoryRepository();

		$filters = array( 'event_date_id' => $event_date_id );
		if ( $post_id ) {
			$filters['post_id'] = $post_id;
		}
		if ( $title ) {
			$filters['title'] = $title;
		}

		$submissions = $submission_repo->get_by_filters( $filters );

		$participant_ids = array();
		foreach ( $submissions as $submission ) {
			if ( $submission->participant_id ) {
				$participant_ids[] = (int) $submission->participant_id;
			}
		}
		$participant_ids   = array_values( array_unique( $participant_ids ) );
		$categories_by_pid = ! empty( $participant_ids )
			? $category_repo->get_categories_for_participants( $participant_ids )
			: array();

		$category_name_cache = array();
		$resolve_categories  = function ( $participant_id ) use ( $categories_by_pid, &$category_name_cache ) {
			$ids = isset( $categories_by_pid[ $participant_id ] ) ? $categories_by_pid[ $participant_id ] : array();
			$out = array();
			foreach ( $ids as $category_id ) {
				$category_id = (int) $category_id;
				if ( ! isset( $category_name_cache[ $category_id ] ) ) {
					$term                                = get_term( $category_id, 'category' );
					$category_name_cache[ $category_id ] = ( $term && ! is_wp_error( $term ) ) ? $term->name : '';
				}
				$out[] = array(
					'id'   => $category_id,
					'name' => $category_name_cache[ $category_id ],
				);
			}
			return $out;
		};

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

			$participant_name    = '';
			$participant_email   = '';
			$participant_status  = '';
			$participant_mailing = '';
			if ( $participant ) {
				$participant_name    = trim( $participant->name . ' ' . $participant->surname );
				$participant_email   = $participant->email;
				$participant_status  = $participant->status;
				$participant_mailing = $participant->email_profile;
			}

			$data[] = array(
				'id'                     => $submission->id,
				'participant_id'         => (int) $submission->participant_id,
				'participant_name'       => $participant_name,
				'participant_email'      => $participant_email,
				'participant_status'     => $participant_status,
				'participant_mailing'    => $participant_mailing,
				'participant_categories' => $resolve_categories( (int) $submission->participant_id ),
				'created_at'             => $submission->created_at,
				'answers'                => $answers_data,
			);
		}

		return new WP_REST_Response( $data, 200 );
	}

	/**
	 * Get forms summary grouped by post_id for an event date.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response Response.
	 */
	public function get_forms_summary( $request ) {
		$event_date_id   = $request->get_param( 'event_date_id' );
		$submission_repo = new QuestionnaireSubmissionRepository();

		$forms = $submission_repo->get_forms_summary_by_event_date( $event_date_id );

		return new WP_REST_Response( $forms, 200 );
	}

	/**
	 * Get all questionnaire responses.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response Response.
	 */
	public function get_all_items( $request ) {
		$submission_repo  = new QuestionnaireSubmissionRepository();
		$participant_repo = new ParticipantRepository();

		$submissions = $submission_repo->get_all();

		$data = array();
		foreach ( $submissions as $submission ) {
			$participant = $participant_repo->get_by_id( $submission->participant_id );

			$participant_name  = '';
			$participant_email = '';
			if ( $participant ) {
				$participant_name  = trim( $participant->name . ' ' . $participant->surname );
				$participant_email = $participant->email;
			}

			$event_name = '';
			if ( $submission->event_date_id && class_exists( '\FairEvents\Models\EventDates' ) ) {
				$event_date = \FairEvents\Models\EventDates::get_by_id( $submission->event_date_id );
				if ( $event_date ) {
					$event = get_post( (int) $event_date->event_id );
					if ( $event ) {
						$event_name = $event->post_title;
					}
				}
			}

			$data[] = array(
				'id'                => $submission->id,
				'title'             => $submission->title,
				'participant_name'  => $participant_name,
				'participant_email' => $participant_email,
				'event_name'        => $event_name,
				'created_at'        => $submission->created_at,
				'post_id'           => $submission->post_id,
				'event_date_id'     => $submission->event_date_id,
			);
		}

		return new WP_REST_Response( $data, 200 );
	}

	/**
	 * Get a single questionnaire response by ID.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error Response.
	 */
	public function get_item( $request ) {
		$id = (int) $request->get_param( 'id' );

		$submission_repo  = new QuestionnaireSubmissionRepository();
		$answer_repo      = new QuestionnaireAnswerRepository();
		$participant_repo = new ParticipantRepository();

		$submission = $submission_repo->get_by_id( $id );

		if ( ! $submission ) {
			return new WP_Error(
				'not_found',
				__( 'Submission not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		$participant = $participant_repo->get_by_id( $submission->participant_id );
		$answers     = $answer_repo->get_by_submission( $submission->id );

		$answers_data = array();
		foreach ( $answers as $answer ) {
			$answer_item = array(
				'question_key'  => $answer->question_key,
				'question_text' => $answer->question_text,
				'question_type' => $answer->question_type,
				'answer_value'  => $answer->answer_value,
			);

			// For file uploads, include the attachment URL.
			if ( 'file_upload' === $answer->question_type && is_numeric( $answer->answer_value ) ) {
				$attachment_url = wp_get_attachment_url( (int) $answer->answer_value );
				if ( $attachment_url ) {
					$answer_item['file_url'] = $attachment_url;
				}
			}

			$answers_data[] = $answer_item;
		}

		$participant_name  = '';
		$participant_email = '';
		if ( $participant ) {
			$participant_name  = trim( $participant->name . ' ' . $participant->surname );
			$participant_email = $participant->email;
		}

		$event_name = '';
		if ( $submission->event_date_id && class_exists( '\FairEvents\Models\EventDates' ) ) {
			$event_date = \FairEvents\Models\EventDates::get_by_id( $submission->event_date_id );
			if ( $event_date ) {
				$event = get_post( (int) $event_date->event_id );
				if ( $event ) {
					$event_name = $event->post_title;
				}
			}
		}

		$data = array(
			'id'                => $submission->id,
			'title'             => $submission->title,
			'participant_id'    => (int) $submission->participant_id,
			'participant_name'  => $participant_name,
			'participant_email' => $participant_email,
			'event_name'        => $event_name,
			'created_at'        => $submission->created_at,
			'post_id'           => $submission->post_id,
			'event_date_id'     => $submission->event_date_id,
			'answers'           => $answers_data,
		);

		return new WP_REST_Response( $data, 200 );
	}

	/**
	 * Update a questionnaire response.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error Response.
	 */
	public function update_item( $request ) {
		$id = (int) $request->get_param( 'id' );

		$submission_repo = new QuestionnaireSubmissionRepository();
		$submission      = $submission_repo->get_by_id( $id );

		if ( ! $submission ) {
			return new WP_Error(
				'not_found',
				__( 'Submission not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		if ( $request->has_param( 'event_date_id' ) ) {
			$event_date_id = (int) $request->get_param( 'event_date_id' );

			if ( $event_date_id > 0 && class_exists( '\FairEvents\Models\EventDates' ) ) {
				$event_date = \FairEvents\Models\EventDates::get_by_id( $event_date_id );
				if ( ! $event_date ) {
					return new WP_Error(
						'invalid_event_date',
						__( 'Event date not found.', 'fair-audience' ),
						array( 'status' => 400 )
					);
				}
			}

			$submission->event_date_id = $event_date_id > 0 ? $event_date_id : null;
		}

		$success = $submission->save();

		if ( ! $success ) {
			return new WP_Error(
				'update_failed',
				__( 'Failed to update submission.', 'fair-audience' ),
				array( 'status' => 500 )
			);
		}

		return $this->get_item( $request );
	}

	/**
	 * Check permissions for delete.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return bool|WP_Error True if allowed.
	 */
	public function delete_item_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}

	/**
	 * Delete a questionnaire response (submission and its answers).
	 *
	 * @param WP_REST_Request $request Request.
	 * @return WP_REST_Response|WP_Error Response.
	 */
	public function delete_item( $request ) {
		$id = (int) $request->get_param( 'id' );

		$submission_repo = new QuestionnaireSubmissionRepository();
		$submission      = $submission_repo->get_by_id( $id );

		if ( ! $submission ) {
			return new WP_Error(
				'not_found',
				__( 'Response not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		$answer_repo = new QuestionnaireAnswerRepository();
		$answer_repo->delete_by_submission( $id );
		$submission_repo->delete_by_id( $id );

		return new WP_REST_Response( null, 204 );
	}
}
