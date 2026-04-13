<?php
/**
 * Timeline REST API Controller
 *
 * @package FairAudience
 */

namespace FairAudience\API;

use FairAudience\Database\TimelineRepository;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;

defined( 'WPINC' ) || die;

/**
 * REST API controller for the activity timeline.
 */
class TimelineController extends WP_REST_Controller {

	/**
	 * REST API namespace.
	 *
	 * @var string
	 */
	protected $namespace = 'fair-audience/v1';

	/**
	 * Repository instance.
	 *
	 * @var TimelineRepository
	 */
	private $repository;

	/**
	 * Constructor.
	 */
	public function __construct() {
		$this->repository = new TimelineRepository();
	}

	/**
	 * Register REST API routes.
	 */
	public function register_routes() {
		register_rest_route(
			$this->namespace,
			'/timeline',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => array( $this, 'admin_permissions_check' ),
					'args'                => array(
						'per_page' => array(
							'default'           => 20,
							'sanitize_callback' => 'absint',
						),
						'page'     => array(
							'default'           => 1,
							'sanitize_callback' => 'absint',
						),
					),
				),
			)
		);
	}

	/**
	 * Check admin permissions.
	 *
	 * @return bool True if user can manage options.
	 */
	public function admin_permissions_check() {
		return current_user_can( 'manage_options' );
	}

	/**
	 * Get timeline items.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response Response object.
	 */
	public function get_items( $request ) {
		$per_page = $request->get_param( 'per_page' );
		$page     = $request->get_param( 'page' );

		$include_payments = class_exists( 'FairPayment\Core\Plugin' );

		// Fetch enough rows from each source to cover the requested page.
		$fetch_limit = $per_page * $page;

		$items = array();

		// Event signups – group by event_date_id + calendar day.
		$signups       = $this->repository->get_recent_signups( $fetch_limit );
		$signup_groups = array();
		foreach ( $signups as $row ) {
			$day = substr( $row['created_at'], 0, 10 ); // YYYY-MM-DD.
			$key = $row['event_date_id'] . '_' . $day;

			if ( ! isset( $signup_groups[ $key ] ) ) {
				$signup_groups[ $key ] = array(
					'rows' => array(),
					'row'  => $row,
				);
			}
			$signup_groups[ $key ]['rows'][] = $row;
		}

		foreach ( $signup_groups as $group ) {
			$first       = $group['row'];
			$count       = count( $group['rows'] );
			$event_title = $first['event_id'] ? get_the_title( (int) $first['event_id'] ) : '';

			if ( $count > 1 ) {
				$summary = sprintf(
					/* translators: 1: number of people, 2: event title */
					_n(
						'%1$d person signed up %2$s',
						'%1$d people signed up %2$s',
						$count,
						'fair-audience'
					),
					$count,
					$event_title
				);
				$id = 'signup_group_' . $first['event_date_id'] . '_' . substr( $first['created_at'], 0, 10 );
			} else {
				$name = trim( $first['participant_name'] . ' ' . $first['participant_surname'] );

				$label_text = 'signed up';
				if ( 'interested' === $first['label'] ) {
					$label_text = 'is interested in';
				} elseif ( 'collaborator' === $first['label'] ) {
					$label_text = 'is collaborating on';
				}

				$summary = sprintf( '%s %s %s', $name, $label_text, $event_title );
				$id      = 'signup_' . $first['id'];
			}

			// Use the most recent created_at from the group.
			$items[] = array(
				'id'         => $id,
				'type'       => 'signup',
				'created_at' => $first['created_at'],
				'summary'    => $summary,
				'details'    => array(
					'event_id'      => (int) $first['event_id'],
					'event_date_id' => (int) $first['event_date_id'],
					'label'         => $first['label'],
					'count'         => $count,
				),
			);
		}

		// Questionnaire submissions.
		$submissions = $this->repository->get_recent_submissions( $fetch_limit );
		foreach ( $submissions as $row ) {
			$name       = trim( $row['participant_name'] . ' ' . $row['participant_surname'] );
			$form_name  = $row['title'] ? $row['title'] : __( 'Fair Form', 'fair-audience' );
			$post_id    = (int) $row['post_id'];
			$page_title = $post_id ? get_the_title( $post_id ) : '';

			if ( $page_title ) {
				$summary = sprintf(
					/* translators: 1: participant name, 2: form name, 3: page title */
					__( '%1$s submitted "%2$s" on "%3$s"', 'fair-audience' ),
					$name,
					$form_name,
					$page_title
				);
			} else {
				$summary = sprintf(
					/* translators: 1: participant name, 2: form name */
					__( '%1$s submitted "%2$s"', 'fair-audience' ),
					$name,
					$form_name
				);
			}

			$items[] = array(
				'id'         => 'form_submission_' . $row['id'],
				'type'       => 'form_submission',
				'created_at' => $row['created_at'],
				'summary'    => $summary,
				'details'    => array(
					'submission_id' => (int) $row['id'],
					'event_date_id' => (int) $row['event_date_id'],
					'post_id'       => $post_id,
					'page_title'    => $page_title,
				),
			);
		}

		// Membership fees (conditional).
		if ( $include_payments ) {
			$fees = $this->repository->get_recent_fees( $fetch_limit );
			foreach ( $fees as $row ) {
				$currency = $row['currency'] ?? 'EUR';

				// Build pending breakdown string: "15 × 45€, 1 × 30€".
				$pending_parts = array();
				foreach ( $row['pending_groups'] as $group ) {
					$pending_parts[] = sprintf(
						'%d × %s %s',
						(int) $group['count'],
						number_format( (float) $group['amount'], 2 ),
						$currency
					);
				}
				$pending_text = $pending_parts ? implode( ', ', $pending_parts ) : '0';

				$items[] = array(
					'id'         => 'fee_' . $row['id'],
					'type'       => 'fee',
					'created_at' => $row['created_at'],
					'summary'    => $row['name'],
					'details'    => array(
						'fee_id'       => (int) $row['id'],
						'fee_name'     => $row['name'],
						'currency'     => $currency,
						'total_amount' => (float) $row['total_amount'],
						'total_paid'   => (float) $row['total_paid'],
						'pending_text' => $pending_text,
						'status'       => $row['status'],
					),
				);
			}
		}

		// Custom emails.
		$emails = $this->repository->get_recent_emails( $fetch_limit );
		foreach ( $emails as $row ) {
			$items[] = array(
				'id'         => 'email_' . $row['id'],
				'type'       => 'email',
				'created_at' => $row['created_at'],
				'summary'    => sprintf( 'Email "%s" sent to %d recipients', $row['subject'], (int) $row['sent_count'] ),
				'details'    => array(
					'subject'       => $row['subject'],
					'sent_count'    => (int) $row['sent_count'],
					'failed_count'  => (int) $row['failed_count'],
					'skipped_count' => (int) $row['skipped_count'],
				),
			);
		}

		// Instagram posts.
		$ig_posts = $this->repository->get_recent_instagram_posts( $fetch_limit );
		foreach ( $ig_posts as $row ) {
			$caption = mb_strimwidth( $row['caption'] ?? '', 0, 80, '…' );

			$items[] = array(
				'id'         => 'instagram_' . $row['id'],
				'type'       => 'instagram',
				'created_at' => $row['created_at'],
				'summary'    => sprintf( 'Instagram post (%s): "%s"', $row['status'], $caption ),
				'details'    => array(
					'status'    => $row['status'],
					'permalink' => $row['permalink'],
				),
			);
		}

		// Polls.
		$polls = $this->repository->get_recent_polls( $fetch_limit );
		foreach ( $polls as $row ) {
			$items[] = array(
				'id'         => 'poll_' . $row['id'],
				'type'       => 'poll',
				'created_at' => $row['created_at'],
				'summary'    => sprintf( 'Poll "%s" created (%s)', $row['title'], $row['status'] ),
				'details'    => array(
					'title'  => $row['title'],
					'status' => $row['status'],
				),
			);
		}

		// New participants.
		$participants = $this->repository->get_recent_participants( $fetch_limit );
		foreach ( $participants as $row ) {
			$name = trim( $row['name'] . ' ' . $row['surname'] );

			$items[] = array(
				'id'         => 'new_participant_' . $row['id'],
				'type'       => 'new_participant',
				'created_at' => $row['created_at'],
				'summary'    => sprintf( 'New participant: %s', $name ),
				'details'    => array(
					'email' => $row['email'],
				),
			);
		}

		// Sort all items by created_at descending.
		usort(
			$items,
			function ( $a, $b ) {
				return strcmp( $b['created_at'], $a['created_at'] );
			}
		);

		// Pagination.
		$total       = $this->repository->get_total_count( $include_payments );
		$total_pages = (int) ceil( $total / $per_page );
		$offset      = ( $page - 1 ) * $per_page;
		$paged_items = array_slice( $items, $offset, $per_page );

		$response = new WP_REST_Response( $paged_items, 200 );
		$response->header( 'X-WP-Total', $total );
		$response->header( 'X-WP-TotalPages', $total_pages );

		return $response;
	}
}
