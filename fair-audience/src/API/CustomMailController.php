<?php
/**
 * Custom Mail REST API Controller
 *
 * @package FairAudience
 */

namespace FairAudience\API;

use FairAudience\Database\CustomMailMessageRepository;
use FairAudience\Services\EmailService;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * REST API controller for custom mail.
 */
class CustomMailController extends WP_REST_Controller {

	/**
	 * REST API namespace.
	 *
	 * @var string
	 */
	protected $namespace = 'fair-audience/v1';

	/**
	 * Repository instance.
	 *
	 * @var CustomMailMessageRepository
	 */
	private $repository;

	/**
	 * Email service instance.
	 *
	 * @var EmailService
	 */
	private $email_service;

	/**
	 * Constructor.
	 */
	public function __construct() {
		$this->repository    = new CustomMailMessageRepository();
		$this->email_service = new EmailService();
	}

	/**
	 * Register REST API routes.
	 */
	public function register_routes() {
		// GET /fair-audience/v1/custom-mail - List sent messages.
		register_rest_route(
			$this->namespace,
			'/custom-mail',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => array( $this, 'admin_permissions_check' ),
				),
			)
		);

		// POST /fair-audience/v1/custom-mail - Send a custom mail.
		register_rest_route(
			$this->namespace,
			'/custom-mail',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_item' ),
					'permission_callback' => array( $this, 'admin_permissions_check' ),
					'args'                => array(
						'subject'       => array(
							'type'              => 'string',
							'required'          => true,
							'sanitize_callback' => 'sanitize_text_field',
						),
						'content'       => array(
							'type'     => 'string',
							'required' => true,
						),
						'event_date_id' => array(
							'type'              => 'integer',
							'required'          => false,
							'default'           => 0,
							'sanitize_callback' => 'absint',
						),
						'is_marketing'  => array(
							'type'    => 'boolean',
							'default' => true,
						),
						'labels'        => array(
							'type'              => 'array',
							'required'          => false,
							'default'           => array( 'signed_up', 'collaborator' ),
							'items'             => array(
								'type' => 'string',
								'enum' => array( 'signed_up', 'collaborator', 'interested' ),
							),
							'sanitize_callback' => function ( $value ) {
								$allowed = array( 'signed_up', 'collaborator', 'interested' );
								return array_values( array_intersect( (array) $value, $allowed ) );
							},
						),
					),
				),
			)
		);

		// DELETE /fair-audience/v1/custom-mail/{id} - Delete a record.
		register_rest_route(
			$this->namespace,
			'/custom-mail/(?P<id>[\d]+)',
			array(
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'delete_item' ),
					'permission_callback' => array( $this, 'admin_permissions_check' ),
					'args'                => array(
						'id' => array(
							'type'              => 'integer',
							'required'          => true,
							'sanitize_callback' => 'absint',
						),
					),
				),
			)
		);

		// GET /fair-audience/v1/custom-mail/events - List event dates for dropdown.
		register_rest_route(
			$this->namespace,
			'/custom-mail/events',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_event_dates' ),
					'permission_callback' => array( $this, 'admin_permissions_check' ),
				),
			)
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
				__( 'You do not have permission to manage custom mail.', 'fair-audience' ),
				array( 'status' => 403 )
			);
		}

		return true;
	}

	/**
	 * Get all custom mail messages.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response Response object.
	 */
	public function get_items( $request ) {
		$messages = $this->repository->get_all();

		$data = array_map(
			function ( $message ) {
				return $this->prepare_message( $message );
			},
			$messages
		);

		return rest_ensure_response( $data );
	}

	/**
	 * Send a custom mail and create a record.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object.
	 */
	public function create_item( $request ) {
		$subject       = $request->get_param( 'subject' );
		$content       = wp_kses_post( $request->get_param( 'content' ) );
		$event_date_id = $request->get_param( 'event_date_id' );
		$is_marketing  = $request->get_param( 'is_marketing' );
		$labels        = $request->get_param( 'labels' );

		$event_id = null;

		if ( $event_date_id ) {
			// Look up event_date to get event_id.
			global $wpdb;
			$event_dates_table = $wpdb->prefix . 'fair_event_dates';

			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$event_date = $wpdb->get_row(
				$wpdb->prepare(
					'SELECT * FROM %i WHERE id = %d',
					$event_dates_table,
					$event_date_id
				),
				ARRAY_A
			);

			if ( ! $event_date ) {
				return new WP_Error(
					'invalid_event_date',
					__( 'Event date not found.', 'fair-audience' ),
					array( 'status' => 404 )
				);
			}

			$event_id = (int) $event_date['event_id'];

			// Send to event participants filtered by labels.
			$results = $this->email_service->send_bulk_custom_mail(
				$event_id,
				$subject,
				$content,
				$is_marketing,
				$labels
			);
		} else {
			// Send to all audience members.
			$results = $this->email_service->send_bulk_custom_mail_to_all(
				$subject,
				$content,
				$is_marketing
			);
		}

		// Save the record.
		$message                = new \FairAudience\Models\CustomMailMessage();
		$message->subject       = $subject;
		$message->content       = $content;
		$message->event_date_id = $event_date_id ?: null;
		$message->event_id      = $event_id;
		$message->is_marketing  = $is_marketing;
		$message->sent_count    = count( $results['sent'] );
		$message->failed_count  = count( $results['failed'] );
		$message->skipped_count = count( $results['skipped'] );
		$message->save();

		return rest_ensure_response(
			array(
				'success'       => true,
				'sent_count'    => count( $results['sent'] ),
				'failed_count'  => count( $results['failed'] ),
				'skipped_count' => count( $results['skipped'] ),
				'sent'          => $results['sent'],
				'failed'        => $results['failed'],
				'skipped'       => $results['skipped'],
			)
		);
	}

	/**
	 * Delete a custom mail message record.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object.
	 */
	public function delete_item( $request ) {
		$id = $request->get_param( 'id' );

		$message = $this->repository->get_by_id( $id );
		if ( ! $message ) {
			return new WP_Error(
				'not_found',
				__( 'Custom mail message not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		$this->repository->delete( $id );

		return rest_ensure_response( array( 'success' => true ) );
	}

	/**
	 * Get event dates for dropdown selection.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response Response object.
	 */
	public function get_event_dates( $request ) {
		global $wpdb;

		$event_dates_table = $wpdb->prefix . 'fair_event_dates';
		$posts_table       = $wpdb->posts;

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$results = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT ed.id, ed.event_id, ed.start_datetime, p.post_title
				FROM %i ed
				INNER JOIN %i p ON ed.event_id = p.ID
				WHERE p.post_status = %s
				ORDER BY ed.start_datetime DESC',
				$event_dates_table,
				$posts_table,
				'publish'
			),
			ARRAY_A
		);

		$data = array_map(
			function ( $row ) {
				$date_display = '';
				if ( ! empty( $row['start_datetime'] ) ) {
					$date_display = wp_date( 'Y-m-d H:i', strtotime( $row['start_datetime'] ) );
				}

				return array(
					'id'             => (int) $row['id'],
					'event_id'       => (int) $row['event_id'],
					'title'          => $row['post_title'],
					'start_datetime' => $row['start_datetime'],
					'display_label'  => $row['post_title'] . ( $date_display ? ' (' . $date_display . ')' : '' ),
				);
			},
			$results
		);

		return rest_ensure_response( $data );
	}

	/**
	 * Prepare message for response.
	 *
	 * @param \FairAudience\Models\CustomMailMessage $message Message object.
	 * @return array Prepared data.
	 */
	private function prepare_message( $message ) {
		$event_title = '';
		if ( $message->event_id ) {
			$event = get_post( $message->event_id );
			if ( $event ) {
				$event_title = $event->post_title;
			}
		}

		return array(
			'id'            => $message->id,
			'subject'       => $message->subject,
			'event_id'      => $message->event_id,
			'event_title'   => $event_title,
			'is_marketing'  => $message->is_marketing,
			'sent_count'    => $message->sent_count,
			'failed_count'  => $message->failed_count,
			'skipped_count' => $message->skipped_count,
			'created_at'    => $message->created_at,
		);
	}
}
