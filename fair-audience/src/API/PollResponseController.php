<?php
/**
 * Poll Response REST API Controller
 *
 * @package FairAudience
 */

namespace FairAudience\API;

use FairAudience\Database\PollRepository;
use FairAudience\Database\PollOptionRepository;
use FairAudience\Database\PollAccessKeyRepository;
use FairAudience\Database\PollResponseRepository;
use FairAudience\Database\ParticipantRepository;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * REST API controller for public poll responses.
 */
class PollResponseController extends WP_REST_Controller {

	/**
	 * REST API namespace.
	 *
	 * @var string
	 */
	protected $namespace = 'fair-audience/v1';

	/**
	 * REST API base route.
	 *
	 * @var string
	 */
	protected $rest_base = 'poll-response';

	/**
	 * Poll repository instance.
	 *
	 * @var PollRepository
	 */
	private $poll_repository;

	/**
	 * Poll option repository instance.
	 *
	 * @var PollOptionRepository
	 */
	private $option_repository;

	/**
	 * Poll access key repository instance.
	 *
	 * @var PollAccessKeyRepository
	 */
	private $access_key_repository;

	/**
	 * Poll response repository instance.
	 *
	 * @var PollResponseRepository
	 */
	private $response_repository;

	/**
	 * Participant repository instance.
	 *
	 * @var ParticipantRepository
	 */
	private $participant_repository;

	/**
	 * Constructor.
	 */
	public function __construct() {
		$this->poll_repository        = new PollRepository();
		$this->option_repository      = new PollOptionRepository();
		$this->access_key_repository  = new PollAccessKeyRepository();
		$this->response_repository    = new PollResponseRepository();
		$this->participant_repository = new ParticipantRepository();
	}

	/**
	 * Register REST API routes.
	 */
	public function register_routes() {
		// GET /fair-audience/v1/poll-response/validate
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/validate',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'validate' ),
					'permission_callback' => '__return_true',
					'args'                => array(
						'access_key' => array(
							'type'              => 'string',
							'required'          => true,
							'sanitize_callback' => 'sanitize_text_field',
						),
					),
				),
			)
		);

		// POST /fair-audience/v1/poll-response/submit
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/submit',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'submit' ),
					'permission_callback' => '__return_true',
					'args'                => array(
						'access_key'          => array(
							'type'              => 'string',
							'required'          => true,
							'sanitize_callback' => 'sanitize_text_field',
						),
						'selected_option_ids' => array(
							'type'     => 'array',
							'required' => true,
							'items'    => array(
								'type' => 'integer',
							),
						),
					),
				),
			)
		);
	}

	/**
	 * Validate access key and return poll data.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function validate( $request ) {
		$token = $request->get_param( 'access_key' );

		// Hash the token to look up in database.
		$access_key_hash = hash( 'sha256', $token );

		$access_key = $this->access_key_repository->get_by_access_key( $access_key_hash );

		if ( ! $access_key ) {
			return rest_ensure_response(
				array(
					'valid' => false,
				)
			);
		}

		// Get poll.
		$poll = $this->poll_repository->get_by_id( $access_key->poll_id );

		if ( ! $poll ) {
			return rest_ensure_response(
				array(
					'valid' => false,
				)
			);
		}

		// Get participant.
		$participant = $this->participant_repository->get_by_id( $access_key->participant_id );

		// Get options.
		$options = $this->option_repository->get_by_poll( $poll->id );

		// Check if already responded.
		$already_responded = 'responded' === $access_key->status || $this->response_repository->has_responded( $poll->id, $access_key->participant_id );

		return rest_ensure_response(
			array(
				'valid'             => true,
				'poll'              => array(
					'id'       => $poll->id,
					'question' => $poll->question,
					'status'   => $poll->status,
					'options'  => array_map(
						function ( $option ) {
							return array(
								'id'   => $option->id,
								'text' => $option->option_text,
							);
						},
						$options
					),
				),
				'participant_name'  => $participant ? $participant->name : '',
				'already_responded' => $already_responded,
			)
		);
	}

	/**
	 * Submit poll response.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function submit( $request ) {
		$token               = $request->get_param( 'access_key' );
		$selected_option_ids = $request->get_param( 'selected_option_ids' );

		// Rate limiting check.
		$ip            = $_SERVER['REMOTE_ADDR'];
		$transient_key = 'poll_attempt_' . md5( $ip );
		$attempts      = get_transient( $transient_key );

		if ( false === $attempts ) {
			$attempts = 0;
		}

		if ( $attempts >= 5 ) {
			return new WP_Error(
				'rate_limit_exceeded',
				__( 'Too many submission attempts. Please try again later.', 'fair-audience' ),
				array( 'status' => 429 )
			);
		}

		set_transient( $transient_key, $attempts + 1, 15 * MINUTE_IN_SECONDS );

		// Hash the token to look up in database.
		$access_key_hash = hash( 'sha256', $token );

		$access_key = $this->access_key_repository->get_by_access_key( $access_key_hash );

		if ( ! $access_key ) {
			return new WP_Error(
				'invalid_access_key',
				__( 'Invalid or expired access key.', 'fair-audience' ),
				array( 'status' => 403 )
			);
		}

		// Check if already responded.
		if ( 'responded' === $access_key->status ) {
			return new WP_Error(
				'already_responded',
				__( 'You have already responded to this poll.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		// Get poll.
		$poll = $this->poll_repository->get_by_id( $access_key->poll_id );

		if ( ! $poll ) {
			return new WP_Error(
				'poll_not_found',
				__( 'Poll not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		// Check if poll is active.
		if ( 'active' !== $poll->status ) {
			return new WP_Error(
				'poll_not_active',
				__( 'This poll is no longer accepting responses.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		// Validate at least one option selected.
		if ( empty( $selected_option_ids ) ) {
			return new WP_Error(
				'no_options_selected',
				__( 'Please select at least one option.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		// Validate that all selected option IDs belong to this poll.
		$poll_options     = $this->option_repository->get_by_poll( $poll->id );
		$valid_option_ids = array_map(
			function ( $option ) {
				return $option->id;
			},
			$poll_options
		);

		foreach ( $selected_option_ids as $option_id ) {
			if ( ! in_array( $option_id, $valid_option_ids, true ) ) {
				return new WP_Error(
					'invalid_option',
					__( 'Invalid option selected.', 'fair-audience' ),
					array( 'status' => 400 )
				);
			}
		}

		// Save responses.
		if ( ! $this->response_repository->save_responses( $poll->id, $access_key->participant_id, $selected_option_ids ) ) {
			return new WP_Error(
				'save_failed',
				__( 'Failed to save your response. Please try again.', 'fair-audience' ),
				array( 'status' => 500 )
			);
		}

		// Mark access key as responded.
		$access_key->mark_as_responded();

		// Clear rate limiting on successful submission.
		delete_transient( $transient_key );

		return rest_ensure_response(
			array(
				'success' => true,
				'message' => __( 'Thank you for your response!', 'fair-audience' ),
			)
		);
	}
}
