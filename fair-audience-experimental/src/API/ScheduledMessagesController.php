<?php
/**
 * Scheduled Messages REST API Controller
 *
 * @package FairAudienceExperimental
 */

namespace FairAudienceExperimental\API;

use FairAudienceExperimental\Database\ScheduledMessageRepository;
use FairAudienceExperimental\Models\ScheduledMessage;
use FairAudience\Services\RecipientResolver;
use FairAudienceExperimental\Services\ScheduledMessageScheduler;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * REST API controller for scheduled per-event-date mailings.
 */
class ScheduledMessagesController extends WP_REST_Controller {

	/**
	 * REST API namespace.
	 *
	 * @var string
	 */
	protected $namespace = 'fair-audience/v1';

	/**
	 * Repository instance.
	 *
	 * @var ScheduledMessageRepository
	 */
	private $repository;

	/**
	 * Recipient resolver instance.
	 *
	 * @var RecipientResolver
	 */
	private $resolver;

	/**
	 * Scheduler instance.
	 *
	 * @var ScheduledMessageScheduler
	 */
	private $scheduler;

	/**
	 * Constructor.
	 */
	public function __construct() {
		$this->repository = new ScheduledMessageRepository();
		$this->resolver   = new RecipientResolver();
		$this->scheduler  = new ScheduledMessageScheduler();
	}

	/**
	 * Register REST API routes.
	 */
	public function register_routes() {
		register_rest_route(
			$this->namespace,
			'/event-dates/(?P<event_date_id>[\d]+)/scheduled-messages',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => array( $this, 'admin_permissions_check' ),
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_item' ),
					'permission_callback' => array( $this, 'admin_permissions_check' ),
					'args'                => $this->get_message_args(),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/event-dates/(?P<event_date_id>[\d]+)/scheduled-messages/preview-recipients',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'preview_draft_recipients' ),
					'permission_callback' => array( $this, 'admin_permissions_check' ),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/scheduled-messages/(?P<id>[\d]+)',
			array(
				array(
					'methods'             => WP_REST_Server::EDITABLE,
					'callback'            => array( $this, 'update_item' ),
					'permission_callback' => array( $this, 'admin_permissions_check' ),
					'args'                => $this->get_message_args(),
				),
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'delete_item' ),
					'permission_callback' => array( $this, 'admin_permissions_check' ),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/scheduled-messages/(?P<id>[\d]+)/preview-recipients',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'preview_recipients' ),
					'permission_callback' => array( $this, 'admin_permissions_check' ),
				),
			)
		);
	}

	/**
	 * Argument schema shared by create and update.
	 *
	 * @return array Args definition.
	 */
	private function get_message_args() {
		return array(
			'subject'           => array(
				'type'              => 'string',
				'required'          => true,
				'sanitize_callback' => 'sanitize_text_field',
			),
			'body'              => array(
				'type'     => 'string',
				'required' => true,
			),
			'anchor_type'       => array(
				'type'     => 'string',
				'required' => true,
				'enum'     => array( 'event_date_start', 'event_date_end', 'sale_period_start', 'sale_period_end' ),
			),
			'anchor_ref_id'     => array(
				'type'              => 'integer',
				'required'          => true,
				'sanitize_callback' => 'absint',
			),
			'offset_minutes'    => array(
				'type'              => 'integer',
				'required'          => false,
				'default'           => 0,
				'sanitize_callback' => static function ( $value ) {
					return (int) $value;
				},
			),
			'recipients_filter' => array(
				'type'     => 'object',
				'required' => false,
				'default'  => array(),
			),
		);
	}

	/**
	 * Check admin permissions.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return bool|WP_Error True if allowed.
	 */
	public function admin_permissions_check( $request ) {
		if ( ! current_user_can( 'manage_options' ) ) {
			return new WP_Error(
				'rest_forbidden',
				__( 'You do not have permission to manage scheduled messages.', 'fair-audience-experimental' ),
				array( 'status' => 403 )
			);
		}

		return true;
	}

	/**
	 * List scheduled messages for an event date.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return \WP_REST_Response Response object.
	 */
	public function get_items( $request ) {
		$event_date_id = (int) $request->get_param( 'event_date_id' );
		$messages      = $this->repository->get_by_event_date( $event_date_id );

		$data = array_map(
			function ( $message ) {
				return $this->prepare_message( $message );
			},
			$messages
		);

		return rest_ensure_response( $data );
	}

	/**
	 * Create a scheduled message for an event date.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return \WP_REST_Response|WP_Error Response object.
	 */
	public function create_item( $request ) {
		$event_date_id = (int) $request->get_param( 'event_date_id' );

		$anchor = $this->validate_anchor( $request, $event_date_id );
		if ( is_wp_error( $anchor ) ) {
			return $anchor;
		}

		$message                    = new ScheduledMessage();
		$message->event_date_id     = $event_date_id;
		$message->subject           = $request->get_param( 'subject' );
		$message->body              = wp_kses_post( $request->get_param( 'body' ) );
		$message->anchor_type       = $request->get_param( 'anchor_type' );
		$message->anchor_ref_id     = $anchor['anchor_ref_id'];
		$message->offset_minutes    = (int) $request->get_param( 'offset_minutes' );
		$message->recipients_filter = $this->resolver->normalize_filter( $request->get_param( 'recipients_filter' ) );
		$message->status            = 'scheduled';
		$message->created_by        = get_current_user_id();
		$message->scheduled_for     = $this->scheduler->compute_scheduled_for(
			$message->anchor_type,
			$message->anchor_ref_id,
			$message->offset_minutes
		);

		if ( ! $message->save() ) {
			return new WP_Error( 'save_failed', __( 'Could not save the scheduled message.', 'fair-audience-experimental' ), array( 'status' => 500 ) );
		}

		return rest_ensure_response( $this->prepare_message( $this->repository->get_by_id( $message->id ) ) );
	}

	/**
	 * Update a scheduled message (only while status=scheduled).
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return \WP_REST_Response|WP_Error Response object.
	 */
	public function update_item( $request ) {
		$message = $this->repository->get_by_id( (int) $request->get_param( 'id' ) );
		if ( ! $message ) {
			return new WP_Error( 'not_found', __( 'Scheduled message not found.', 'fair-audience-experimental' ), array( 'status' => 404 ) );
		}

		if ( 'scheduled' !== $message->status ) {
			return new WP_Error(
				'not_editable',
				__( 'Only scheduled messages can be edited.', 'fair-audience-experimental' ),
				array( 'status' => 409 )
			);
		}

		$anchor = $this->validate_anchor( $request, $message->event_date_id );
		if ( is_wp_error( $anchor ) ) {
			return $anchor;
		}

		$message->subject           = $request->get_param( 'subject' );
		$message->body              = wp_kses_post( $request->get_param( 'body' ) );
		$message->anchor_type       = $request->get_param( 'anchor_type' );
		$message->anchor_ref_id     = $anchor['anchor_ref_id'];
		$message->offset_minutes    = (int) $request->get_param( 'offset_minutes' );
		$message->recipients_filter = $this->resolver->normalize_filter( $request->get_param( 'recipients_filter' ) );
		$message->scheduled_for     = $this->scheduler->compute_scheduled_for(
			$message->anchor_type,
			$message->anchor_ref_id,
			$message->offset_minutes
		);

		if ( ! $message->save() ) {
			return new WP_Error( 'save_failed', __( 'Could not update the scheduled message.', 'fair-audience-experimental' ), array( 'status' => 500 ) );
		}

		return rest_ensure_response( $this->prepare_message( $this->repository->get_by_id( $message->id ) ) );
	}

	/**
	 * Cancel a scheduled message (only while status=scheduled).
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return \WP_REST_Response|WP_Error Response object.
	 */
	public function delete_item( $request ) {
		$message = $this->repository->get_by_id( (int) $request->get_param( 'id' ) );
		if ( ! $message ) {
			return new WP_Error( 'not_found', __( 'Scheduled message not found.', 'fair-audience-experimental' ), array( 'status' => 404 ) );
		}

		if ( 'scheduled' !== $message->status ) {
			return new WP_Error(
				'not_cancelable',
				__( 'Only scheduled messages can be canceled.', 'fair-audience-experimental' ),
				array( 'status' => 409 )
			);
		}

		$message->status = 'canceled';
		$message->save();

		return rest_ensure_response( $this->prepare_message( $this->repository->get_by_id( $message->id ) ) );
	}

	/**
	 * Resolve recipients for a stored message, as of now.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return \WP_REST_Response|WP_Error Response object.
	 */
	public function preview_recipients( $request ) {
		$message = $this->repository->get_by_id( (int) $request->get_param( 'id' ) );
		if ( ! $message ) {
			return new WP_Error( 'not_found', __( 'Scheduled message not found.', 'fair-audience-experimental' ), array( 'status' => 404 ) );
		}

		$recipients = $this->resolver->resolve_by_event_date( $message->recipients_filter, $message->event_date_id );

		return rest_ensure_response( $recipients );
	}

	/**
	 * Resolve recipients for an unsaved draft from a posted filter.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return \WP_REST_Response Response object.
	 */
	public function preview_draft_recipients( $request ) {
		$event_date_id = (int) $request->get_param( 'event_date_id' );
		$filter        = $request->get_param( 'recipients_filter' );

		$recipients = $this->resolver->resolve_by_event_date( $filter, $event_date_id );

		return rest_ensure_response( $recipients );
	}

	/**
	 * Validate the anchor for a create/update request.
	 *
	 * Rejects sale-period anchors (until #617). A mailing is scoped to one event
	 * date, so the anchor always refers to that date: the anchor row is forced to
	 * the scoping event date and verified to exist.
	 *
	 * @param WP_REST_Request $request       Request object.
	 * @param int             $event_date_id Event date the mailing is scoped to.
	 * @return array|WP_Error {anchor_ref_id, event_date_id} or error.
	 */
	private function validate_anchor( $request, $event_date_id ) {
		$anchor_type = $request->get_param( 'anchor_type' );

		if ( ! ScheduledMessageScheduler::is_supported_anchor( $anchor_type ) ) {
			return new WP_Error(
				'unsupported_anchor',
				__( 'Sale-period anchors are not supported yet.', 'fair-audience-experimental' ),
				array( 'status' => 400 )
			);
		}

		global $wpdb;
		$table = $wpdb->prefix . 'fair_event_dates';

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$exists = $wpdb->get_var(
			$wpdb->prepare( 'SELECT id FROM %i WHERE id = %d', $table, $event_date_id )
		);

		if ( ! $exists ) {
			return new WP_Error(
				'invalid_event_date',
				__( 'Event date not found.', 'fair-audience-experimental' ),
				array( 'status' => 404 )
			);
		}

		return array(
			'anchor_ref_id' => $event_date_id,
			'event_date_id' => $event_date_id,
		);
	}

	/**
	 * Prepare a message for the REST response.
	 *
	 * @param ScheduledMessage $message Message object.
	 * @return array Prepared data.
	 */
	private function prepare_message( $message ) {
		return array(
			'id'                => $message->id,
			'event_date_id'     => $message->event_date_id,
			'subject'           => $message->subject,
			'body'              => $message->body,
			'anchor_type'       => $message->anchor_type,
			'anchor_ref_id'     => $message->anchor_ref_id,
			'offset_minutes'    => $message->offset_minutes,
			'recipients_filter' => $message->recipients_filter,
			'scheduled_for'     => $message->scheduled_for,
			'status'            => $message->status,
			'sent_count'        => $message->sent_count,
			'failed_count'      => $message->failed_count,
			'skipped_count'     => $message->skipped_count,
			'sent_at'           => $message->sent_at,
			'last_error'        => $message->last_error,
			'created_at'        => $message->created_at,
			'updated_at'        => $message->updated_at,
		);
	}
}
