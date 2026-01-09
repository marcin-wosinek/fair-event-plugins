<?php
/**
 * Polls REST API Controller
 *
 * @package FairAudience
 */

namespace FairAudience\API;

use FairAudience\Database\PollRepository;
use FairAudience\Database\PollOptionRepository;
use FairAudience\Database\PollAccessKeyRepository;
use FairAudience\Models\Poll;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * REST API controller for polls.
 */
class PollsController extends WP_REST_Controller {

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
	protected $rest_base = 'polls';

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
	 * Constructor.
	 */
	public function __construct() {
		$this->poll_repository       = new PollRepository();
		$this->option_repository     = new PollOptionRepository();
		$this->access_key_repository = new PollAccessKeyRepository();
	}

	/**
	 * Register REST API routes.
	 */
	public function register_routes() {
		// GET /fair-audience/v1/polls
		// POST /fair-audience/v1/polls
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
					'args'                => array(
						'event_id' => array(
							'type'              => 'integer',
							'required'          => false,
							'sanitize_callback' => 'absint',
						),
						'status'   => array(
							'type'              => 'string',
							'required'          => false,
							'enum'              => array( 'draft', 'active', 'closed' ),
							'sanitize_callback' => 'sanitize_text_field',
						),
					),
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_item' ),
					'permission_callback' => array( $this, 'create_item_permissions_check' ),
					'args'                => array(
						'event_id' => array(
							'type'              => 'integer',
							'required'          => true,
							'sanitize_callback' => 'absint',
						),
						'title'    => array(
							'type'              => 'string',
							'required'          => true,
							'sanitize_callback' => 'sanitize_text_field',
						),
						'question' => array(
							'type'              => 'string',
							'required'          => true,
							'sanitize_callback' => 'sanitize_textarea_field',
						),
						'options'  => array(
							'type'     => 'array',
							'required' => true,
							'items'    => array(
								'type'       => 'object',
								'properties' => array(
									'text'  => array( 'type' => 'string' ),
									'order' => array( 'type' => 'integer' ),
								),
							),
						),
						'status'   => array(
							'type'              => 'string',
							'required'          => false,
							'default'           => 'draft',
							'enum'              => array( 'draft', 'active', 'closed' ),
							'sanitize_callback' => 'sanitize_text_field',
						),
					),
				),
			)
		);

		// GET /fair-audience/v1/polls/{id}
		// PUT /fair-audience/v1/polls/{id}
		// DELETE /fair-audience/v1/polls/{id}
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<id>\d+)',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_item' ),
					'permission_callback' => array( $this, 'get_item_permissions_check' ),
					'args'                => array(
						'id' => array(
							'type'     => 'integer',
							'required' => true,
						),
					),
				),
				array(
					'methods'             => WP_REST_Server::EDITABLE,
					'callback'            => array( $this, 'update_item' ),
					'permission_callback' => array( $this, 'update_item_permissions_check' ),
					'args'                => array(
						'id'       => array(
							'type'     => 'integer',
							'required' => true,
						),
						'title'    => array(
							'type'              => 'string',
							'required'          => false,
							'sanitize_callback' => 'sanitize_text_field',
						),
						'question' => array(
							'type'              => 'string',
							'required'          => false,
							'sanitize_callback' => 'sanitize_textarea_field',
						),
						'status'   => array(
							'type'              => 'string',
							'required'          => false,
							'enum'              => array( 'draft', 'active', 'closed' ),
							'sanitize_callback' => 'sanitize_text_field',
						),
						'options'  => array(
							'type'     => 'array',
							'required' => false,
							'items'    => array(
								'type'       => 'object',
								'properties' => array(
									'id'    => array( 'type' => 'integer' ),
									'text'  => array( 'type' => 'string' ),
									'order' => array( 'type' => 'integer' ),
								),
							),
						),
					),
				),
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'delete_item' ),
					'permission_callback' => array( $this, 'delete_item_permissions_check' ),
					'args'                => array(
						'id' => array(
							'type'     => 'integer',
							'required' => true,
						),
					),
				),
			)
		);

		// POST /fair-audience/v1/polls/{id}/send-invitations
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<id>\d+)/send-invitations',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'send_invitations' ),
					'permission_callback' => array( $this, 'send_invitations_permissions_check' ),
					'args'                => array(
						'id'      => array(
							'type'     => 'integer',
							'required' => true,
						),
						'subject' => array(
							'type'              => 'string',
							'required'          => false,
							'sanitize_callback' => 'sanitize_text_field',
						),
						'message' => array(
							'type'              => 'string',
							'required'          => false,
							'sanitize_callback' => 'sanitize_textarea_field',
						),
					),
				),
			)
		);
	}

	/**
	 * Get all polls.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response Response object.
	 */
	public function get_items( $request ) {
		$event_id = $request->get_param( 'event_id' );
		$status   = $request->get_param( 'status' );

		$polls = $this->poll_repository->get_all( $event_id, $status );

		$items = array_map(
			function ( $poll ) {
				return array(
					'id'         => $poll->id,
					'event_id'   => $poll->event_id,
					'title'      => $poll->title,
					'question'   => $poll->question,
					'status'     => $poll->status,
					'created_at' => $poll->created_at,
					'updated_at' => $poll->updated_at,
				);
			},
			$polls
		);

		return rest_ensure_response( $items );
	}

	/**
	 * Get single poll with options.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function get_item( $request ) {
		$id   = $request->get_param( 'id' );
		$poll = $this->poll_repository->get_by_id( $id );

		if ( ! $poll ) {
			return new WP_Error(
				'poll_not_found',
				__( 'Poll not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		$options = $this->option_repository->get_by_poll( $id );
		$stats   = $this->access_key_repository->get_detailed_stats( $id );

		$item = array(
			'id'         => $poll->id,
			'event_id'   => $poll->event_id,
			'title'      => $poll->title,
			'question'   => $poll->question,
			'status'     => $poll->status,
			'created_at' => $poll->created_at,
			'updated_at' => $poll->updated_at,
			'options'    => array_map(
				function ( $option ) {
					return array(
						'id'    => $option->id,
						'text'  => $option->option_text,
						'order' => $option->display_order,
					);
				},
				$options
			),
			'stats'      => $stats,
		);

		return rest_ensure_response( $item );
	}

	/**
	 * Create poll with options.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function create_item( $request ) {
		$event_id = $request->get_param( 'event_id' );
		$title    = $request->get_param( 'title' );
		$question = $request->get_param( 'question' );
		$status   = $request->get_param( 'status' );
		$options  = $request->get_param( 'options' );

		// Validate event exists.
		$event = get_post( $event_id );
		if ( ! $event || 'fair_event' !== $event->post_type ) {
			return new WP_Error(
				'invalid_event',
				__( 'Invalid event ID.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		// Create poll.
		$poll = new Poll();
		$poll->populate(
			array(
				'event_id' => $event_id,
				'title'    => $title,
				'question' => $question,
				'status'   => $status ? $status : 'draft',
			)
		);

		if ( ! $poll->save() ) {
			return new WP_Error(
				'poll_create_failed',
				__( 'Failed to create poll.', 'fair-audience' ),
				array( 'status' => 500 )
			);
		}

		// Create options.
		if ( ! empty( $options ) ) {
			if ( ! $this->option_repository->bulk_create( $poll->id, $options ) ) {
				return new WP_Error(
					'options_create_failed',
					__( 'Failed to create poll options.', 'fair-audience' ),
					array( 'status' => 500 )
				);
			}
		}

		return rest_ensure_response(
			array(
				'poll_id' => $poll->id,
				'message' => __( 'Poll created successfully.', 'fair-audience' ),
			)
		);
	}

	/**
	 * Update poll and options.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function update_item( $request ) {
		$id   = $request->get_param( 'id' );
		$poll = $this->poll_repository->get_by_id( $id );

		if ( ! $poll ) {
			return new WP_Error(
				'poll_not_found',
				__( 'Poll not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		// Update poll fields.
		$title    = $request->get_param( 'title' );
		$question = $request->get_param( 'question' );
		$status   = $request->get_param( 'status' );

		if ( $title ) {
			$poll->title = $title;
		}
		if ( $question ) {
			$poll->question = $question;
		}
		if ( $status ) {
			$poll->status = $status;
		}

		if ( ! $poll->save() ) {
			return new WP_Error(
				'poll_update_failed',
				__( 'Failed to update poll.', 'fair-audience' ),
				array( 'status' => 500 )
			);
		}

		// Update options if provided.
		$options = $request->get_param( 'options' );
		if ( null !== $options ) {
			// Delete all existing options.
			$this->option_repository->delete_all_for_poll( $id );

			// Create new options.
			if ( ! empty( $options ) ) {
				if ( ! $this->option_repository->bulk_create( $id, $options ) ) {
					return new WP_Error(
						'options_update_failed',
						__( 'Failed to update poll options.', 'fair-audience' ),
						array( 'status' => 500 )
					);
				}
			}
		}

		return rest_ensure_response(
			array(
				'message' => __( 'Poll updated successfully.', 'fair-audience' ),
			)
		);
	}

	/**
	 * Delete poll.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function delete_item( $request ) {
		$id   = $request->get_param( 'id' );
		$poll = $this->poll_repository->get_by_id( $id );

		if ( ! $poll ) {
			return new WP_Error(
				'poll_not_found',
				__( 'Poll not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		if ( ! $this->poll_repository->delete( $id ) ) {
			return new WP_Error(
				'poll_delete_failed',
				__( 'Failed to delete poll.', 'fair-audience' ),
				array( 'status' => 500 )
			);
		}

		return rest_ensure_response(
			array(
				'deleted' => true,
				'message' => __( 'Poll deleted successfully.', 'fair-audience' ),
			)
		);
	}

	/**
	 * Send poll invitations to event participants.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function send_invitations( $request ) {
		$id   = $request->get_param( 'id' );
		$poll = $this->poll_repository->get_by_id( $id );

		if ( ! $poll ) {
			return new WP_Error(
				'poll_not_found',
				__( 'Poll not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		$subject = $request->get_param( 'subject' );
		$message = $request->get_param( 'message' );

		// Use EmailService to send invitations.
		$email_service = new \FairAudience\Services\EmailService();
		$results       = $email_service->send_bulk_invitations( $id, $subject, $message );

		return rest_ensure_response(
			array(
				'sent_count' => count( $results['sent'] ),
				'failed'     => $results['failed'],
			)
		);
	}

	/**
	 * Permission callback for getting polls.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool True if user has permission.
	 */
	public function get_items_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}

	/**
	 * Permission callback for getting single poll.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool True if user has permission.
	 */
	public function get_item_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}

	/**
	 * Permission callback for creating poll.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool True if user has permission.
	 */
	public function create_item_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}

	/**
	 * Permission callback for updating poll.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool True if user has permission.
	 */
	public function update_item_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}

	/**
	 * Permission callback for deleting poll.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool True if user has permission.
	 */
	public function delete_item_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}

	/**
	 * Permission callback for sending invitations.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool True if user has permission.
	 */
	public function send_invitations_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}
}
