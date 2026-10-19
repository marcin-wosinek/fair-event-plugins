<?php
/**
 * Custom Mail REST API Controller
 *
 * @package FairAudience
 */

namespace FairAudience\API;

use FairAudience\Database\CustomMailMessageRepository;
use FairAudience\Models\CustomMailMessage;
use FairAudience\Services\CustomMailFeatures;
use FairAudience\Services\EmailService;
use FairAudience\Services\RetiredPlaceholders;
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
	 * Group repository instance, or null when the `groups` bundle
	 * (fair-audience-experimental) is not available.
	 *
	 * @var \FairAudienceExperimental\Database\GroupRepository|null
	 */
	private $group_repository;

	/**
	 * Constructor.
	 */
	public function __construct() {
		$this->repository       = new CustomMailMessageRepository();
		$this->email_service    = new EmailService();
		$this->group_repository = CustomMailFeatures::groups_available()
			? new \FairAudienceExperimental\Database\GroupRepository()
			: null;
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
						'subject'              => array(
							'type'              => 'string',
							'required'          => true,
							'sanitize_callback' => 'sanitize_text_field',
						),
						'content'              => array(
							'type'     => 'string',
							'required' => true,
						),
						'event_date_id'        => array(
							'type'              => 'integer',
							'required'          => false,
							'default'           => 0,
							'sanitize_callback' => 'absint',
						),
						'is_marketing'         => array(
							'type'    => 'boolean',
							'default' => true,
						),
						'labels'               => array(
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
						'skip_participant_ids' => array(
							'type'              => 'array',
							'required'          => false,
							'default'           => array(),
							'items'             => array(
								'type' => 'integer',
							),
							'sanitize_callback' => function ( $value ) {
								return array_map( 'absint', (array) $value );
							},
						),
						'group_ids'            => array(
							'type'              => 'array',
							'required'          => false,
							'default'           => array(),
							'items'             => array(
								'type' => 'integer',
							),
							'sanitize_callback' => function ( $value ) {
								return array_map( 'absint', (array) $value );
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

		// POST /fair-audience/v1/custom-mail/preview - Preview recipients.
		register_rest_route(
			$this->namespace,
			'/custom-mail/preview',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'preview_recipients' ),
					'permission_callback' => array( $this, 'admin_permissions_check' ),
					'args'                => array(
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
						'group_ids'     => array(
							'type'              => 'array',
							'required'          => false,
							'default'           => array(),
							'items'             => array(
								'type' => 'integer',
							),
							'sanitize_callback' => function ( $value ) {
								return array_map( 'absint', (array) $value );
							},
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

		// GET /fair-audience/v1/custom-mail/groups - List groups for filtering.
		register_rest_route(
			$this->namespace,
			'/custom-mail/groups',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_groups' ),
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
				// 401 for a visitor who is not logged in, 403 otherwise.
				array( 'status' => rest_authorization_required_code() )
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
	 * Resolve the audience an email is addressed to.
	 *
	 * An unknown occurrence is an error; it never widens the send to the whole
	 * audience. No occurrence at all means the whole audience, which only the
	 * experimental messaging feature allows.
	 *
	 * @param int $event_date_id Event date ID, or 0 for the whole audience.
	 * @return array{event_date_id:int,event_id:int|null}|WP_Error Scope or error.
	 */
	private function resolve_scope( $event_date_id ) {
		$event_date_id = (int) $event_date_id;

		if ( ! $event_date_id ) {
			if ( ! CustomMailFeatures::all_audience_available() ) {
				return new WP_Error(
					'event_date_required',
					__( 'Select the event whose participants should receive this email.', 'fair-audience' ),
					array( 'status' => 400 )
				);
			}

			return array(
				'event_date_id' => 0,
				'event_id'      => null,
			);
		}

		global $wpdb;

		// An occurrence of a series may carry the event only on its master.
		$event_dates_table = $wpdb->prefix . 'fair_event_dates';

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$event_id = (int) $wpdb->get_var(
			$wpdb->prepare(
				'SELECT COALESCE( ed.event_id, m.event_id )
				FROM %i ed
				LEFT JOIN %i m ON ed.master_id = m.id
				WHERE ed.id = %d',
				$event_dates_table,
				$event_dates_table,
				$event_date_id
			)
		);

		if ( ! $event_id || ! get_post( $event_id ) ) {
			return new WP_Error(
				'invalid_event_date',
				__( 'Event date not found.', 'fair-audience' ),
				array( 'status' => 404 )
			);
		}

		return array(
			'event_date_id' => $event_date_id,
			'event_id'      => $event_id,
		);
	}

	/**
	 * Validate the recipient filter against the resolved scope.
	 *
	 * @param array $scope     Scope from resolve_scope().
	 * @param array $labels    Requested participant labels.
	 * @param array $group_ids Requested group IDs.
	 * @return true|WP_Error True when valid.
	 */
	private function validate_filter( $scope, $labels, $group_ids ) {
		if ( $scope['event_date_id'] && empty( $labels ) ) {
			return new WP_Error(
				'no_audience_selected',
				__( 'Select at least one audience type.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		if ( ! empty( $group_ids ) && ! $this->group_repository ) {
			return new WP_Error(
				'groups_unavailable',
				__( 'Filtering by group is not available on this site.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		return true;
	}

	/**
	 * Whether sanitized HTML has anything a recipient would see.
	 *
	 * Catches empty markup such as `<p>&nbsp;</p>` left behind by the editor.
	 *
	 * @param string $content Sanitized HTML.
	 * @return bool
	 */
	private function has_visible_content( $content ) {
		if ( false !== stripos( $content, '<img' ) ) {
			return true;
		}

		$text = html_entity_decode( wp_strip_all_tags( $content ), ENT_QUOTES, 'UTF-8' );
		$text = str_replace( "\xc2\xa0", ' ', $text );

		return '' !== trim( $text );
	}

	/**
	 * Validate the subject and sanitized body of a message.
	 *
	 * @param string $subject Sanitized subject.
	 * @param string $content Sanitized HTML body.
	 * @return true|WP_Error True when valid.
	 */
	private function validate_message( $subject, $content ) {
		if ( '' === trim( (string) $subject ) ) {
			return new WP_Error(
				'empty_subject',
				__( 'Enter a subject for the email.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		// A retired photo upload link is dropped when sending, so it does not
		// count as content.
		if ( ! $this->has_visible_content( RetiredPlaceholders::strip( $content ) ) ) {
			return new WP_Error(
				'empty_content',
				__( 'Write the email content before sending.', 'fair-audience' ),
				array( 'status' => 400 )
			);
		}

		return true;
	}

	/**
	 * Send a custom mail and create a record.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object.
	 */
	public function create_item( $request ) {
		$subject              = $request->get_param( 'subject' );
		$content              = wp_kses_post( $request->get_param( 'content' ) );
		$is_marketing         = $request->get_param( 'is_marketing' );
		$labels               = $request->get_param( 'labels' );
		$skip_participant_ids = $request->get_param( 'skip_participant_ids' );
		$group_ids            = $request->get_param( 'group_ids' );

		$valid = $this->validate_message( $subject, $content );
		if ( is_wp_error( $valid ) ) {
			return $valid;
		}

		$scope = $this->resolve_scope( $request->get_param( 'event_date_id' ) );
		if ( is_wp_error( $scope ) ) {
			return $scope;
		}

		$valid = $this->validate_filter( $scope, $labels, $group_ids );
		if ( is_wp_error( $valid ) ) {
			return $valid;
		}

		if ( $scope['event_date_id'] ) {
			// Send to the participants of this occurrence, filtered by labels.
			$results = $this->email_service->send_bulk_custom_mail(
				$scope['event_id'],
				$subject,
				$content,
				$is_marketing,
				$labels,
				$skip_participant_ids,
				$scope['event_date_id'],
				$group_ids
			);
		} else {
			// Send to all audience members.
			$results = $this->email_service->send_bulk_custom_mail_to_all(
				$subject,
				$content,
				$is_marketing,
				$skip_participant_ids,
				$group_ids
			);
		}

		// Save the record. The emails are already out at this point, so a
		// failed write is reported on its own rather than as a failed send.
		$message                = new CustomMailMessage();
		$message->subject       = $subject;
		$message->content       = $content;
		$message->event_date_id = $scope['event_date_id'] ? $scope['event_date_id'] : null;
		$message->event_id      = $scope['event_id'];
		$message->is_marketing  = $is_marketing;
		$message->sent_count    = count( $results['sent'] );
		$message->failed_count  = count( $results['failed'] );
		$message->skipped_count = count( $results['skipped'] );
		$history_saved          = $message->save();

		return rest_ensure_response(
			array(
				'success'       => true,
				'history_saved' => (bool) $history_saved,
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
	 * Preview recipients for a custom mail.
	 *
	 * Uses the same scope and filter rules as create_item(), so the list shown
	 * is the list a send would walk.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object.
	 */
	public function preview_recipients( $request ) {
		$is_marketing = $request->get_param( 'is_marketing' );
		$labels       = $request->get_param( 'labels' );
		$group_ids    = $request->get_param( 'group_ids' );

		$scope = $this->resolve_scope( $request->get_param( 'event_date_id' ) );
		if ( is_wp_error( $scope ) ) {
			return $scope;
		}

		$valid = $this->validate_filter( $scope, $labels, $group_ids );
		if ( is_wp_error( $valid ) ) {
			return $valid;
		}

		if ( $scope['event_date_id'] ) {
			$recipients = $this->email_service->preview_custom_mail_recipients(
				$scope['event_id'],
				$is_marketing,
				$labels,
				$group_ids,
				$scope['event_date_id']
			);
		} else {
			$recipients = $this->email_service->preview_custom_mail_recipients_all( $is_marketing, $group_ids );
		}

		return rest_ensure_response( $recipients );
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
				'SELECT ed.*, p.ID AS event_id, p.post_title
				FROM %i ed
				LEFT JOIN %i m ON ed.master_id = m.id
				INNER JOIN %i p ON COALESCE( ed.event_id, m.event_id ) = p.ID
				WHERE p.post_status = %s
				ORDER BY ed.start_date DESC, ed.start_time DESC',
				$event_dates_table,
				$event_dates_table,
				$posts_table,
				'publish'
			),
			ARRAY_A
		);

		$data = array_map(
			function ( $row ) {
				// Stored values are naive site-local strings: format them as
				// written, without shifting them by the site's UTC offset. A
				// date without a start time (or an all-day one) shows the date
				// alone, never a midnight that was not set.
				$date_display = '';
				if ( ! empty( $row['start_date'] ) ) {
					$has_time     = empty( $row['all_day'] ) && ! empty( $row['start_time'] );
					$date_display = date_i18n(
						$has_time ? get_option( 'date_format' ) . ' ' . get_option( 'time_format' ) : get_option( 'date_format' ),
						strtotime( $row['start_date'] . ' ' . ( $has_time ? $row['start_time'] : '00:00:00' ) )
					);
				}

				$title = '' !== trim( (string) $row['post_title'] )
					? $row['post_title']
					: __( '(untitled event)', 'fair-audience' );

				return array(
					'id'            => (int) $row['id'],
					'event_id'      => (int) $row['event_id'],
					'title'         => $title,
					'start_date'    => $row['start_date'],
					'start_time'    => empty( $row['all_day'] ) ? $row['start_time'] : null,
					'display_label' => $date_display
						/* translators: 1: event title, 2: event date and time */
						? sprintf( __( '%1$s (%2$s)', 'fair-audience' ), $title, $date_display )
						: $title,
				);
			},
			$results
		);

		return rest_ensure_response( $data );
	}

	/**
	 * Get groups for filtering selection.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response Response object.
	 */
	public function get_groups( $request ) {
		$groups = $this->group_repository ? $this->group_repository->get_all_with_member_counts() : array();

		$data = array_map(
			function ( $group ) {
				return array(
					'id'           => $group->id,
					'name'         => $group->name,
					'member_count' => $group->member_count,
				);
			},
			$groups
		);

		return rest_ensure_response( $data );
	}

	/**
	 * Prepare message for response.
	 *
	 * @param CustomMailMessage $message Message object.
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
			'content'       => $message->content,
			'event_id'      => $message->event_id,
			'event_date_id' => $message->event_date_id,
			'event_title'   => $event_title,
			'is_marketing'  => $message->is_marketing,
			'sent_count'    => $message->sent_count,
			'failed_count'  => $message->failed_count,
			'skipped_count' => $message->skipped_count,
			'created_at'    => $message->created_at,
		);
	}
}
