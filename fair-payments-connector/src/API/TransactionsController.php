<?php
/**
 * REST API Controller for Transactions
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\API;

defined( 'WPINC' ) || die;

use FairPaymentsConnector\Models\Transaction;
use FairPaymentsConnector\Models\LineItem;
use FairPaymentsConnector\Models\EntryTransaction;
use FairPaymentsConnector\Payment\MolliePaymentHandler;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

/**
 * Handles transaction REST API endpoints
 */
class TransactionsController extends WP_REST_Controller {

	/**
	 * Namespace for the REST API
	 *
	 * @var string
	 */
	protected $namespace = 'fair-payments-connector/v1';

	/**
	 * Register the routes for transactions
	 *
	 * @return void
	 */
	public function register_routes() {
		register_rest_route(
			$this->namespace,
			'/transactions',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
					'args'                => $this->get_collection_params(),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/transactions/(?P<id>\d+)',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_item' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
					'args'                => array(
						'id' => array(
							'type'              => 'integer',
							'required'          => true,
							'sanitize_callback' => 'absint',
						),
					),
				),
				array(
					'methods'             => WP_REST_Server::EDITABLE,
					'callback'            => array( $this, 'update_item' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
					'args'                => array(
						'id'             => array(
							'type'              => 'integer',
							'required'          => true,
							'sanitize_callback' => 'absint',
						),
						'participant_id' => array(
							'type'              => 'integer',
							'sanitize_callback' => 'absint',
						),
						'user_id'        => array(
							'type'              => 'integer',
							'sanitize_callback' => 'absint',
						),
						'post_id'        => array(
							'type'              => 'integer',
							'sanitize_callback' => 'absint',
						),
					),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/transactions/import',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'import_items' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
					'args'                => array(
						'transactions' => array(
							'type'     => 'array',
							'required' => true,
						),
					),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/transactions/mollie',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_mollie_payments' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
					'args'                => $this->get_mollie_args(),
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'import_mollie_payments' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
					'args'                => array_merge(
						$this->get_mollie_args(),
						array(
							'payment_ids' => array(
								'type'     => 'array',
								'required' => true,
								'minItems' => 1,
								'maxItems' => 50,
								'items'    => array(
									'type'    => 'string',
									'pattern' => '^tr_[A-Za-z0-9]+$',
								),
							),
						)
					),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/transactions/missing-mollie-fee',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_missing_mollie_fee_ids' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
					'args'                => array(
						'mode' => array(
							'type'              => 'string',
							'default'           => '',
							'enum'              => array( '', 'live', 'test' ),
							'sanitize_callback' => 'sanitize_text_field',
						),
					),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/transactions/(?P<id>\d+)/sync-mollie',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'sync_mollie' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
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

		register_rest_route(
			$this->namespace,
			'/transactions/sync-mollie-batch',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'sync_mollie_batch' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
					'args'                => array(
						'ids' => array(
							'type'              => 'array',
							'required'          => true,
							'minItems'          => 1,
							'maxItems'          => 25,
							'items'             => array(
								'type' => 'integer',
							),
							// WP_REST_Request::has_valid_params() only runs a
							// validate_callback when one is explicitly set — the
							// minItems/maxItems/items schema above is otherwise
							// never enforced, so validate the bounds here too.
							'validate_callback' => function ( $ids ) {
								if ( ! is_array( $ids ) || count( $ids ) < 1 || count( $ids ) > 25 ) {
									return new WP_Error(
										'invalid_ids',
										__( 'Provide between 1 and 25 transaction ids.', 'fair-payments-connector' ),
										array( 'status' => 400 )
									);
								}
								return true;
							},
							'sanitize_callback' => function ( $ids ) {
								return array_map( 'absint', (array) $ids );
							},
						),
					),
				),
			)
		);
	}

	/**
	 * Check permissions for getting items
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool
	 */
	public function get_items_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}

	/**
	 * Get a collection of transactions
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response
	 */
	public function get_items( $request ) {
		$per_page = $request->get_param( 'per_page' ) ?? 50;
		$page     = $request->get_param( 'page' ) ?? 1;
		$offset   = ( $page - 1 ) * $per_page;

		$query_args = array(
			'limit'         => $per_page,
			'offset'        => $offset,
			'status'        => $request->get_param( 'status' ) ?? '',
			'mode'          => $request->get_param( 'mode' ) ?? '',
			'event_date_id' => $request->get_param( 'event_date_id' ) ?? 0,
			'orderby'       => $request->get_param( 'orderby' ) ?? 'created_at',
			'order'         => $request->get_param( 'order' ) ?? 'DESC',
		);

		$transactions = Transaction::get_all( $query_args );
		$total        = Transaction::count(
			array(
				'status'        => $query_args['status'],
				'mode'          => $query_args['mode'],
				'event_date_id' => $query_args['event_date_id'],
			)
		);

		$transaction_ids  = array_map(
			function ( $t ) {
				return (int) $t->id;
			},
			$transactions
		);
		$entry_ids_by_txn = EntryTransaction::get_entry_ids_for_transactions( $transaction_ids );

		$data = array();
		foreach ( $transactions as $transaction ) {
			$user_name = '';
			if ( $transaction->user_id ) {
				$user = get_userdata( $transaction->user_id );
				if ( $user ) {
					$user_name = $user->display_name;
				}
			}

			$participant_id = isset( $transaction->participant_id ) && $transaction->participant_id
				? (int) $transaction->participant_id
				: null;
			$participant    = apply_filters( 'fair_payment_prepare_participant', null, $participant_id );

			$event_url = '';
			if ( $transaction->event_date_id && class_exists( '\\FairEvents\\Models\\EventDates' ) ) {
				$event_date = \FairEvents\Models\EventDates::get_by_id( (int) $transaction->event_date_id );
				if ( $event_date && ! empty( $event_date->event_id ) ) {
					$permalink = get_permalink( (int) $event_date->event_id );
					if ( $permalink ) {
						$event_url = $permalink;
					}
				}
			}

			$data[] = array(
				'id'                => (int) $transaction->id,
				'mollie_payment_id' => $transaction->mollie_payment_id ?? '',
				'event_date_id'     => $transaction->event_date_id ? (int) $transaction->event_date_id : null,
				'event_url'         => $event_url,
				'amount'            => (float) ( $transaction->amount ?? 0 ),
				'currency'          => $transaction->currency ?? 'EUR',
				'mollie_fee'        => null !== $transaction->mollie_fee ? (float) $transaction->mollie_fee : null,
				'application_fee'   => null !== $transaction->application_fee ? (float) $transaction->application_fee : null,
				'status'            => $transaction->status ?? 'unknown',
				'testmode'          => ! empty( $transaction->testmode ),
				'description'       => $transaction->description ?? '',
				'user_name'         => $user_name,
				'participant_id'    => $participant_id,
				'participant'       => $participant,
				'entry_ids'         => $entry_ids_by_txn[ (int) $transaction->id ] ?? array(),
				'created_at'        => $transaction->created_at ? get_date_from_gmt( $transaction->created_at ) : '',
			);
		}

		return new WP_REST_Response(
			array(
				'transactions' => $data,
				'total'        => $total,
				'pages'        => ceil( $total / $per_page ),
				'page'         => (int) $page,
			),
			200
		);
	}

	/**
	 * Get a single transaction
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function get_item( $request ) {
		// Sync with Mollie to capture missing fee or update pending status.
		$transaction = TransactionAPI::sync_transaction_status( $request->get_param( 'id' ) );

		if ( ! $transaction ) {
			return new WP_Error(
				'not_found',
				__( 'Transaction not found.', 'fair-payments-connector' ),
				array( 'status' => 404 )
			);
		}

		return new WP_REST_Response( $this->prepare_transaction_response( $transaction ), 200 );
	}

	/**
	 * Update editable fields on a transaction.
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function update_item( $request ) {
		$transaction = Transaction::get_by_id( $request->get_param( 'id' ) );

		if ( ! $transaction ) {
			return new WP_Error(
				'not_found',
				__( 'Transaction not found.', 'fair-payments-connector' ),
				array( 'status' => 404 )
			);
		}

		$fields = array();

		if ( null !== $request->get_param( 'participant_id' ) ) {
			$participant_id           = $request->get_param( 'participant_id' );
			$fields['participant_id'] = $participant_id ? $participant_id : null;
		}

		if ( null !== $request->get_param( 'user_id' ) ) {
			$user_id           = $request->get_param( 'user_id' );
			$fields['user_id'] = $user_id ? $user_id : null;
		}

		if ( null !== $request->get_param( 'post_id' ) ) {
			$post_id           = $request->get_param( 'post_id' );
			$fields['post_id'] = $post_id ? $post_id : null;
		}

		if ( empty( $fields ) ) {
			return new WP_Error(
				'no_fields',
				__( 'No fields to update.', 'fair-payments-connector' ),
				array( 'status' => 400 )
			);
		}

		$updated = Transaction::update_fields( (int) $transaction->id, $fields );

		if ( ! $updated ) {
			return new WP_Error(
				'update_failed',
				__( 'Failed to update transaction.', 'fair-payments-connector' ),
				array( 'status' => 500 )
			);
		}

		$transaction = Transaction::get_by_id( (int) $transaction->id );

		return new WP_REST_Response( $this->prepare_transaction_response( $transaction ), 200 );
	}

	/**
	 * Import transactions from an exported JSON payload.
	 *
	 * Creates new rows or updates existing ones matched by mollie_payment_id.
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function import_items( $request ) {
		$transactions = $request->get_param( 'transactions' );

		if ( ! is_array( $transactions ) ) {
			return new WP_Error(
				'invalid_payload',
				__( 'Expected an array of transactions.', 'fair-payments-connector' ),
				array( 'status' => 400 )
			);
		}

		$created = 0;
		$updated = 0;
		$skipped = 0;

		foreach ( $transactions as $transaction ) {
			if ( ! is_array( $transaction ) ) {
				++$skipped;
				continue;
			}

			$result = Transaction::import( $transaction );

			if ( 'created' === $result ) {
				++$created;
			} elseif ( 'updated' === $result ) {
				++$updated;
			} else {
				++$skipped;
			}
		}

		return new WP_REST_Response(
			array(
				'created' => $created,
				'updated' => $updated,
				'skipped' => $skipped,
				'message' => sprintf(
					/* translators: 1: created count, 2: updated count, 3: skipped count */
					__( 'Imported %1$d new, updated %2$d, skipped %3$d transaction(s).', 'fair-payments-connector' ),
					$created,
					$updated,
					$skipped
				),
			),
			200
		);
	}

	/**
	 * List eligible Mollie payments.
	 *
	 * @param WP_REST_Request $request Full request data.
	 * @return WP_REST_Response|WP_Error
	 */
	public function get_mollie_payments( $request ) {
		if ( ! in_array( $request['mode'], array( 'live', 'test' ), true ) ) {
			return new WP_Error( 'invalid_mode', __( 'Choose live or test mode.', 'fair-payments-connector' ), array( 'status' => 400 ) );
		}
		if ( ! MolliePaymentHandler::is_configured() ) {
			return new WP_REST_Response( $this->mollie_connection_state(), 200 );
		}

		$date_error = $this->validate_mollie_dates( $request );
		if ( is_wp_error( $date_error ) ) {
			return $date_error;
		}

		try {
			$handler = new MolliePaymentHandler();
			$page    = $handler->list_payments( $request['from'], (int) $request['limit'], 'test' === $request['mode'] );
			$rows    = array();
			$oldest  = false;
			$last_id = null;
			foreach ( $page as $payment ) {
				$last_id = $payment->id;
				// phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Mollie API field.
				$created = strtotime( $payment->createdAt );
				if ( $created < strtotime( $request['start_date'] . ' 00:00:00 UTC' ) ) {
					$oldest = true;
					break;
				}
				if ( 'paid' !== $payment->status || $created > strtotime( $request['end_date'] . ' 23:59:59 UTC' ) ) {
					continue;
				}
				$row                     = $handler->map_payment_for_import( $payment );
				$row['already_imported'] = (bool) Transaction::get_by_mollie_id( $payment->id );
				$rows[]                  = $row;
			}
			$next = ( ! $oldest && $page->hasNext() ) ? $last_id : null;
			return new WP_REST_Response(
				array_merge(
					$this->mollie_connection_state(),
					array(
						'payments'      => $rows,
						'next'          => $next,
						'limit_reached' => (bool) $next,
					)
				),
				200
			);
		} catch ( \Exception $e ) {
			return new WP_Error( 'mollie_api_error', __( 'Mollie payments could not be loaded. Please try again.', 'fair-payments-connector' ), array( 'status' => 502 ) );
		}
	}

	/**
	 * Import selected payments after re-fetching them from Mollie.
	 *
	 * @param WP_REST_Request $request Full request data.
	 * @return WP_REST_Response|WP_Error
	 * @throws \Exception When the Mollie client cannot be initialized.
	 */
	public function import_mollie_payments( $request ) {
		if ( ! in_array( $request['mode'], array( 'live', 'test' ), true ) ) {
			return new WP_Error( 'invalid_mode', __( 'Choose live or test mode.', 'fair-payments-connector' ), array( 'status' => 400 ) );
		}
		$date_error = $this->validate_mollie_dates( $request );
		if ( is_wp_error( $date_error ) ) {
			return $date_error;
		}
		if ( ! MolliePaymentHandler::is_configured() ) {
			return new WP_Error(
				'mollie_not_connected',
				__( 'Connect Mollie before importing payments.', 'fair-payments-connector' ),
				array(
					'status'       => 400,
					'settings_url' => $this->mollie_connection_state()['settings_url'],
				)
			);
		}
		$handler = new MolliePaymentHandler();
		$result  = array(
			'imported' => 0,
			'skipped'  => 0,
			'failed'   => 0,
			'failures' => array(),
		);
		foreach ( array_unique( $request['payment_ids'] ) as $payment_id ) {
			try {
				$payment = $handler->get_payment( $payment_id, array( 'testmode' => 'test' === $request['mode'] ) );
				if ( 'paid' !== $payment->status || $payment->mode !== $request['mode'] ) {
					throw new \Exception( 'ineligible' );
				}
				$state = Transaction::import_mollie_create_only( $handler->map_payment_for_import( $payment ) );
				if ( 'created' === $state ) {
					++$result['imported'];
				} elseif ( 'existing' === $state ) {
					++$result['skipped'];
				} else {
					throw new \Exception( 'insert_failed' );
				}
			} catch ( \Exception $e ) {
				++$result['failed'];
				$result['failures'][] = array(
					'payment_id' => $payment_id,
					'message'    => __( 'This payment could not be imported.', 'fair-payments-connector' ),
				);
			}
		}
		$result['message'] = sprintf(
			/* translators: 1: imported count, 2: skipped count, 3: failed count. */
			__( 'Imported %1$d, skipped %2$d, and failed %3$d payment(s).', 'fair-payments-connector' ),
			$result['imported'],
			$result['skipped'],
			$result['failed']
		);
		return new WP_REST_Response( $result, 200 );
	}

	/** Return safe Mollie connection details for the browser. */
	private function mollie_connection_state() {
		return array(
			'connected'    => MolliePaymentHandler::is_configured(),
			'default_mode' => get_option( 'fair_payment_mode', 'test' ),
			'settings_url' => add_query_arg( 'page', 'fair-payments-connector-settings', admin_url( 'admin.php' ) ),
		);
	}

	/**
	 * Validate the bounded date range.
	 *
	 * @param WP_REST_Request $request Full request data.
	 * @return true|WP_Error
	 */
	private function validate_mollie_dates( $request ) {
		$start = strtotime( $request['start_date'] . ' 00:00:00 UTC' );
		$end   = strtotime( $request['end_date'] . ' 23:59:59 UTC' );
		if ( false === $start || false === $end || $start > $end || ( $end - $start ) > 90 * DAY_IN_SECONDS ) {
			return new WP_Error( 'invalid_date_range', __( 'Choose a valid date range of no more than 90 days.', 'fair-payments-connector' ), array( 'status' => 400 ) );
		}
		return true;
	}

	/** Return the shared Mollie route arguments. */
	private function get_mollie_args() {
		return array(
			'mode'       => array(
				'type'              => 'string',
				'required'          => true,
				'enum'              => array( 'live', 'test' ),
				'sanitize_callback' => 'sanitize_text_field',
			),
			'start_date' => array(
				'type'              => 'string',
				'required'          => true,
				'format'            => 'date',
				'sanitize_callback' => 'sanitize_text_field',
			),
			'end_date'   => array(
				'type'              => 'string',
				'required'          => true,
				'format'            => 'date',
				'sanitize_callback' => 'sanitize_text_field',
			),
			'from'       => array(
				'type'              => 'string',
				'default'           => '',
				'pattern'           => '^(|tr_[A-Za-z0-9]+)$',
				'sanitize_callback' => 'sanitize_text_field',
			),
			'limit'      => array(
				'type'              => 'integer',
				'default'           => 25,
				'minimum'           => 1,
				'maximum'           => 50,
				'sanitize_callback' => 'absint',
			),
		);
	}

	/**
	 * List IDs of paid transactions missing Mollie fee data.
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response
	 */
	public function get_missing_mollie_fee_ids( $request ) {
		$ids = Transaction::get_ids_missing_mollie_fee( (string) $request->get_param( 'mode' ) );

		return new WP_REST_Response(
			array(
				'ids'   => $ids,
				'total' => count( $ids ),
			),
			200
		);
	}

	/**
	 * Force a Mollie sync for a transaction to refresh status and fee data.
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function sync_mollie( $request ) {
		$result = TransactionAPI::sync_transaction_status( $request->get_param( 'id' ), true );

		if ( null === $result ) {
			return new WP_Error(
				'not_found',
				__( 'Transaction not found.', 'fair-payments-connector' ),
				array( 'status' => 404 )
			);
		}

		if ( is_wp_error( $result ) ) {
			$result->add_data( array( 'status' => 400 ) );
			return $result;
		}

		return new WP_REST_Response( $this->prepare_transaction_response( $result ), 200 );
	}

	/**
	 * Force a Mollie sync for a batch of transactions.
	 *
	 * Every id is attempted independently: one failure never stops the rest
	 * of the batch. A per-id outcome is data, not a request error, so this
	 * always returns 200 with the tallied counts.
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response
	 */
	public function sync_mollie_batch( $request ) {
		$ids = array_unique( (array) $request->get_param( 'ids' ) );

		$updated = 0;
		$failed  = 0;

		foreach ( $ids as $id ) {
			$result = TransactionAPI::sync_transaction_status( (int) $id, true );

			if ( $result && ! is_wp_error( $result ) && null !== $result->mollie_fee ) {
				++$updated;
			} else {
				++$failed;
			}
		}

		return new WP_REST_Response(
			array(
				'processed' => count( $ids ),
				'updated'   => $updated,
				'failed'    => $failed,
			),
			200
		);
	}

	/**
	 * Build the REST response payload for a transaction row.
	 *
	 * @param object $transaction Transaction record from the DB.
	 * @return array
	 */
	private function prepare_transaction_response( $transaction ) {
		$user_name = '';
		if ( $transaction->user_id ) {
			$user = get_userdata( $transaction->user_id );
			if ( $user ) {
				$user_name = $user->display_name;
			}
		}

		$post_title = '';
		if ( $transaction->post_id ) {
			$post = get_post( $transaction->post_id );
			if ( $post ) {
				$post_title = $post->post_title;
			}
		}

		$metadata = $transaction->metadata ?? '';
		if ( is_string( $metadata ) && '' !== $metadata ) {
			$decoded  = json_decode( $metadata );
			$metadata = ( null !== $decoded ) ? $decoded : $metadata;
		}

		$line_items     = LineItem::get_by_transaction_id( $transaction->id );
		$line_item_data = array();
		foreach ( $line_items as $item ) {
			$line_item_data[] = array(
				'id'           => (int) $item->id,
				'name'         => $item->name,
				'description'  => $item->description ?? '',
				'quantity'     => (int) $item->quantity,
				'unit_amount'  => (float) $item->unit_amount,
				'total_amount' => (float) $item->total_amount,
			);
		}

		$participant_id = isset( $transaction->participant_id ) && $transaction->participant_id
			? (int) $transaction->participant_id
			: null;
		$participant    = apply_filters( 'fair_payment_prepare_participant', null, $participant_id );

		$data = array(
			'id'                   => (int) $transaction->id,
			'mollie_payment_id'    => $transaction->mollie_payment_id ?? '',
			'post_id'              => $transaction->post_id ? (int) $transaction->post_id : null,
			'event_date_id'        => $transaction->event_date_id ? (int) $transaction->event_date_id : null,
			'post_title'           => $post_title,
			'user_id'              => $transaction->user_id ? (int) $transaction->user_id : null,
			'user_name'            => $user_name,
			'participant_id'       => $participant_id,
			'participant'          => $participant,
			'amount'               => (float) ( $transaction->amount ?? 0 ),
			'currency'             => $transaction->currency ?? 'EUR',
			'mollie_fee'           => null !== $transaction->mollie_fee ? (float) $transaction->mollie_fee : null,
			'application_fee'      => null !== $transaction->application_fee ? (float) $transaction->application_fee : null,
			'status'               => $transaction->status ?? 'unknown',
			'testmode'             => ! empty( $transaction->testmode ),
			'description'          => $transaction->description ?? '',
			'redirect_url'         => $transaction->redirect_url ?? '',
			'webhook_url'          => $transaction->webhook_url ?? '',
			'checkout_url'         => $transaction->checkout_url ?? '',
			'metadata'             => $metadata,
			'created_at'           => $transaction->created_at ? get_date_from_gmt( $transaction->created_at ) : '',
			'payment_initiated_at' => $transaction->payment_initiated_at ? get_date_from_gmt( $transaction->payment_initiated_at ) : '',
			'updated_at'           => $transaction->updated_at ? get_date_from_gmt( $transaction->updated_at ) : '',
			'line_items'           => $line_item_data,
		);

		if ( isset( $transaction->sync_debug ) ) {
			$data['sync_debug'] = $transaction->sync_debug;
		}

		return $data;
	}

	/**
	 * Get collection parameters
	 *
	 * @return array
	 */
	public function get_collection_params() {
		return array(
			'page'          => array(
				'type'              => 'integer',
				'default'           => 1,
				'minimum'           => 1,
				'sanitize_callback' => 'absint',
			),
			'per_page'      => array(
				'type'              => 'integer',
				'default'           => 50,
				'minimum'           => 1,
				'maximum'           => 100,
				'sanitize_callback' => 'absint',
			),
			'status'        => array(
				'type'              => 'string',
				'default'           => '',
				'sanitize_callback' => 'sanitize_text_field',
			),
			'mode'          => array(
				'type'              => 'string',
				'default'           => '',
				'enum'              => array( '', 'live', 'test' ),
				'sanitize_callback' => 'sanitize_text_field',
			),
			'event_date_id' => array(
				'type'              => 'integer',
				'default'           => 0,
				'minimum'           => 0,
				'sanitize_callback' => 'absint',
			),
			'orderby'       => array(
				'type'              => 'string',
				'default'           => 'created_at',
				'enum'              => array( 'created_at', 'amount', 'status', 'id' ),
				'sanitize_callback' => 'sanitize_text_field',
			),
			'order'         => array(
				'type'              => 'string',
				'default'           => 'DESC',
				'enum'              => array( 'ASC', 'DESC' ),
				'sanitize_callback' => 'sanitize_text_field',
			),
		);
	}
}
