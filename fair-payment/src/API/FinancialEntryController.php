<?php
/**
 * REST API Controller for Financial Entries
 *
 * @package FairPayment
 */

namespace FairPayment\API;

defined( 'WPINC' ) || die;

use FairPayment\Models\FinancialEntry;
use FairPayment\Models\Transaction;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

/**
 * Handles financial entry REST API endpoints
 */
class FinancialEntryController extends WP_REST_Controller {

	/**
	 * Namespace for the REST API
	 *
	 * @var string
	 */
	protected $namespace = 'fair-payment/v1';

	/**
	 * Register the routes for financial entries
	 *
	 * @return void
	 */
	public function register_routes() {
		// GET /fair-payment/v1/financial-entries - Get all entries (with filters).
		// POST /fair-payment/v1/financial-entries - Create entry.
		register_rest_route(
			$this->namespace,
			'/financial-entries',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
					'args'                => $this->get_collection_params(),
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_item' ),
					'permission_callback' => array( $this, 'create_item_permissions_check' ),
					'args'                => $this->get_create_update_args(),
				),
			)
		);

		// GET /fair-payment/v1/financial-entries/totals - Get totals.
		register_rest_route(
			$this->namespace,
			'/financial-entries/totals',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_totals' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
					'args'                => $this->get_filter_params(),
				),
			)
		);

		// GET /fair-payment/v1/financial-entries/{id} - Get single entry.
		// PUT /fair-payment/v1/financial-entries/{id} - Update entry.
		// DELETE /fair-payment/v1/financial-entries/{id} - Delete entry.
		register_rest_route(
			$this->namespace,
			'/financial-entries/(?P<id>\d+)',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_item' ),
					'permission_callback' => array( $this, 'get_item_permissions_check' ),
					'args'                => array(
						'id' => array(
							'description' => __( 'Unique identifier for the financial entry.', 'fair-payment' ),
							'type'        => 'integer',
						),
					),
				),
				array(
					'methods'             => WP_REST_Server::EDITABLE,
					'callback'            => array( $this, 'update_item' ),
					'permission_callback' => array( $this, 'update_item_permissions_check' ),
					'args'                => $this->get_create_update_args(),
				),
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'delete_item' ),
					'permission_callback' => array( $this, 'delete_item_permissions_check' ),
					'args'                => array(
						'id' => array(
							'description' => __( 'Unique identifier for the financial entry.', 'fair-payment' ),
							'type'        => 'integer',
						),
					),
				),
			)
		);

		// POST /fair-payment/v1/financial-entries/{id}/match - Match entry to transaction.
		register_rest_route(
			$this->namespace,
			'/financial-entries/(?P<id>\d+)/match',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'match_transaction' ),
					'permission_callback' => array( $this, 'update_item_permissions_check' ),
					'args'                => array(
						'id'             => array(
							'description' => __( 'Unique identifier for the financial entry.', 'fair-payment' ),
							'type'        => 'integer',
						),
						'transaction_id' => array(
							'description' => __( 'Transaction ID to match.', 'fair-payment' ),
							'type'        => 'integer',
							'required'    => true,
						),
					),
				),
			)
		);

		// DELETE /fair-payment/v1/financial-entries/{id}/match - Unmatch entry from transaction.
		register_rest_route(
			$this->namespace,
			'/financial-entries/(?P<id>\d+)/match',
			array(
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'unmatch_transaction' ),
					'permission_callback' => array( $this, 'update_item_permissions_check' ),
					'args'                => array(
						'id' => array(
							'description' => __( 'Unique identifier for the financial entry.', 'fair-payment' ),
							'type'        => 'integer',
						),
					),
				),
			)
		);

		// GET /fair-payment/v1/transactions/search - Search transactions for matching.
		register_rest_route(
			$this->namespace,
			'/transactions/search',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'search_transactions' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
					'args'                => array(
						'amount'    => array(
							'description' => __( 'Filter by amount.', 'fair-payment' ),
							'type'        => 'number',
						),
						'date_from' => array(
							'description'       => __( 'Filter by start date.', 'fair-payment' ),
							'type'              => 'string',
							'format'            => 'date',
							'sanitize_callback' => 'sanitize_text_field',
						),
						'date_to'   => array(
							'description'       => __( 'Filter by end date.', 'fair-payment' ),
							'type'              => 'string',
							'format'            => 'date',
							'sanitize_callback' => 'sanitize_text_field',
						),
						'search'    => array(
							'description'       => __( 'Search term.', 'fair-payment' ),
							'type'              => 'string',
							'sanitize_callback' => 'sanitize_text_field',
						),
					),
				),
			)
		);
	}

	/**
	 * Get filter parameters for totals and listing
	 *
	 * @return array Arguments definition.
	 */
	private function get_filter_params() {
		return array(
			'date_from'  => array(
				'description'       => __( 'Filter by start date (Y-m-d format).', 'fair-payment' ),
				'type'              => 'string',
				'format'            => 'date',
				'sanitize_callback' => 'sanitize_text_field',
			),
			'date_to'    => array(
				'description'       => __( 'Filter by end date (Y-m-d format).', 'fair-payment' ),
				'type'              => 'string',
				'format'            => 'date',
				'sanitize_callback' => 'sanitize_text_field',
			),
			'budget_id'  => array(
				'description' => __( 'Filter by budget ID.', 'fair-payment' ),
				'type'        => 'integer',
			),
			'entry_type' => array(
				'description'       => __( 'Filter by entry type: cost or income.', 'fair-payment' ),
				'type'              => 'string',
				'enum'              => array( 'cost', 'income' ),
				'sanitize_callback' => 'sanitize_text_field',
			),
			'unmatched'  => array(
				'description' => __( 'Filter to only unmatched entries.', 'fair-payment' ),
				'type'        => 'boolean',
			),
		);
	}

	/**
	 * Get collection parameters (filter + pagination)
	 *
	 * @return array Arguments definition.
	 */
	public function get_collection_params() {
		return array_merge(
			$this->get_filter_params(),
			array(
				'per_page' => array(
					'description' => __( 'Maximum number of items per page.', 'fair-payment' ),
					'type'        => 'integer',
					'default'     => 50,
					'minimum'     => 1,
					'maximum'     => 100,
				),
				'page'     => array(
					'description' => __( 'Current page number.', 'fair-payment' ),
					'type'        => 'integer',
					'default'     => 1,
					'minimum'     => 1,
				),
			)
		);
	}

	/**
	 * Get arguments for create/update endpoints
	 *
	 * @return array Arguments definition.
	 */
	private function get_create_update_args() {
		return array(
			'amount'         => array(
				'description' => __( 'Entry amount (positive value).', 'fair-payment' ),
				'type'        => 'number',
				'required'    => true,
			),
			'entry_type'     => array(
				'description'       => __( 'Entry type: cost or income.', 'fair-payment' ),
				'type'              => 'string',
				'required'          => true,
				'enum'              => array( 'cost', 'income' ),
				'sanitize_callback' => 'sanitize_text_field',
			),
			'entry_date'     => array(
				'description'       => __( 'Entry date (Y-m-d format).', 'fair-payment' ),
				'type'              => 'string',
				'required'          => true,
				'format'            => 'date',
				'sanitize_callback' => 'sanitize_text_field',
			),
			'description'    => array(
				'description'       => __( 'Entry description.', 'fair-payment' ),
				'type'              => 'string',
				'required'          => false,
				'sanitize_callback' => 'sanitize_textarea_field',
			),
			'budget_id'      => array(
				'description' => __( 'Budget ID.', 'fair-payment' ),
				'type'        => 'integer',
				'required'    => false,
			),
			'transaction_id' => array(
				'description' => __( 'Transaction ID.', 'fair-payment' ),
				'type'        => 'integer',
				'required'    => false,
			),
		);
	}

	/**
	 * Get all entries with filters
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function get_items( $request ) {
		$filters = array(
			'date_from'  => $request->get_param( 'date_from' ),
			'date_to'    => $request->get_param( 'date_to' ),
			'budget_id'  => $request->get_param( 'budget_id' ),
			'entry_type' => $request->get_param( 'entry_type' ),
			'unmatched'  => $request->get_param( 'unmatched' ),
			'per_page'   => $request->get_param( 'per_page' ),
			'page'       => $request->get_param( 'page' ),
		);

		$result = FinancialEntry::get_filtered( $filters );

		$data = array(
			'entries' => array_map(
				function ( $entry ) {
					return $entry->to_array();
				},
				$result['entries']
			),
			'total'   => $result['total'],
			'pages'   => $result['pages'],
		);

		return new WP_REST_Response( $data, 200 );
	}

	/**
	 * Get totals
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function get_totals( $request ) {
		$filters = array(
			'date_from' => $request->get_param( 'date_from' ),
			'date_to'   => $request->get_param( 'date_to' ),
			'budget_id' => $request->get_param( 'budget_id' ),
			'unmatched' => $request->get_param( 'unmatched' ),
		);

		$totals = FinancialEntry::get_totals( $filters );

		return new WP_REST_Response( $totals, 200 );
	}

	/**
	 * Get single entry
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function get_item( $request ) {
		$id    = (int) $request->get_param( 'id' );
		$entry = FinancialEntry::get_by_id( $id );

		if ( ! $entry ) {
			return new WP_Error(
				'rest_entry_not_found',
				__( 'Financial entry not found.', 'fair-payment' ),
				array( 'status' => 404 )
			);
		}

		return new WP_REST_Response( $entry->to_array(), 200 );
	}

	/**
	 * Create new entry
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function create_item( $request ) {
		$amount         = $request->get_param( 'amount' );
		$entry_type     = $request->get_param( 'entry_type' );
		$entry_date     = $request->get_param( 'entry_date' );
		$description    = $request->get_param( 'description' );
		$budget_id      = $request->get_param( 'budget_id' );
		$transaction_id = $request->get_param( 'transaction_id' );

		if ( empty( $amount ) || $amount <= 0 ) {
			return new WP_Error(
				'rest_invalid_amount',
				__( 'Amount must be greater than zero.', 'fair-payment' ),
				array( 'status' => 400 )
			);
		}

		if ( ! in_array( $entry_type, array( 'cost', 'income' ), true ) ) {
			return new WP_Error(
				'rest_invalid_entry_type',
				__( 'Entry type must be cost or income.', 'fair-payment' ),
				array( 'status' => 400 )
			);
		}

		if ( empty( $entry_date ) ) {
			return new WP_Error(
				'rest_invalid_entry_date',
				__( 'Entry date is required.', 'fair-payment' ),
				array( 'status' => 400 )
			);
		}

		$entry_id = FinancialEntry::create(
			$amount,
			$entry_type,
			$entry_date,
			$description,
			! empty( $budget_id ) ? $budget_id : null,
			! empty( $transaction_id ) ? $transaction_id : null
		);

		if ( ! $entry_id ) {
			return new WP_Error(
				'rest_entry_creation_failed',
				__( 'Failed to create financial entry.', 'fair-payment' ),
				array( 'status' => 500 )
			);
		}

		$entry = FinancialEntry::get_by_id( $entry_id );

		return new WP_REST_Response( $entry->to_array(), 201 );
	}

	/**
	 * Update entry
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function update_item( $request ) {
		$id             = (int) $request->get_param( 'id' );
		$amount         = $request->get_param( 'amount' );
		$entry_type     = $request->get_param( 'entry_type' );
		$entry_date     = $request->get_param( 'entry_date' );
		$description    = $request->get_param( 'description' );
		$budget_id      = $request->get_param( 'budget_id' );
		$transaction_id = $request->get_param( 'transaction_id' );

		// Check if entry exists.
		$existing = FinancialEntry::get_by_id( $id );
		if ( ! $existing ) {
			return new WP_Error(
				'rest_entry_not_found',
				__( 'Financial entry not found.', 'fair-payment' ),
				array( 'status' => 404 )
			);
		}

		if ( empty( $amount ) || $amount <= 0 ) {
			return new WP_Error(
				'rest_invalid_amount',
				__( 'Amount must be greater than zero.', 'fair-payment' ),
				array( 'status' => 400 )
			);
		}

		if ( ! in_array( $entry_type, array( 'cost', 'income' ), true ) ) {
			return new WP_Error(
				'rest_invalid_entry_type',
				__( 'Entry type must be cost or income.', 'fair-payment' ),
				array( 'status' => 400 )
			);
		}

		if ( empty( $entry_date ) ) {
			return new WP_Error(
				'rest_invalid_entry_date',
				__( 'Entry date is required.', 'fair-payment' ),
				array( 'status' => 400 )
			);
		}

		$success = FinancialEntry::update(
			$id,
			$amount,
			$entry_type,
			$entry_date,
			$description,
			! empty( $budget_id ) ? $budget_id : null,
			! empty( $transaction_id ) ? $transaction_id : null
		);

		if ( ! $success ) {
			return new WP_Error(
				'rest_entry_update_failed',
				__( 'Failed to update financial entry.', 'fair-payment' ),
				array( 'status' => 500 )
			);
		}

		$entry = FinancialEntry::get_by_id( $id );

		return new WP_REST_Response( $entry->to_array(), 200 );
	}

	/**
	 * Delete entry
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function delete_item( $request ) {
		$id = (int) $request->get_param( 'id' );

		// Check if entry exists.
		$existing = FinancialEntry::get_by_id( $id );
		if ( ! $existing ) {
			return new WP_Error(
				'rest_entry_not_found',
				__( 'Financial entry not found.', 'fair-payment' ),
				array( 'status' => 404 )
			);
		}

		$success = FinancialEntry::delete( $id );

		if ( ! $success ) {
			return new WP_Error(
				'rest_entry_delete_failed',
				__( 'Failed to delete financial entry.', 'fair-payment' ),
				array( 'status' => 500 )
			);
		}

		return new WP_REST_Response(
			array(
				'deleted' => true,
				'entry'   => $existing->to_array(),
			),
			200
		);
	}

	/**
	 * Match entry to transaction
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function match_transaction( $request ) {
		$id             = (int) $request->get_param( 'id' );
		$transaction_id = (int) $request->get_param( 'transaction_id' );

		// Check if entry exists.
		$entry = FinancialEntry::get_by_id( $id );
		if ( ! $entry ) {
			return new WP_Error(
				'rest_entry_not_found',
				__( 'Financial entry not found.', 'fair-payment' ),
				array( 'status' => 404 )
			);
		}

		// Check if transaction exists.
		$transaction = Transaction::get_by_id( $transaction_id );
		if ( ! $transaction ) {
			return new WP_Error(
				'rest_transaction_not_found',
				__( 'Transaction not found.', 'fair-payment' ),
				array( 'status' => 404 )
			);
		}

		$success = FinancialEntry::match_transaction( $id, $transaction_id );

		if ( ! $success ) {
			return new WP_Error(
				'rest_match_failed',
				__( 'Failed to match entry to transaction.', 'fair-payment' ),
				array( 'status' => 500 )
			);
		}

		$entry = FinancialEntry::get_by_id( $id );

		return new WP_REST_Response( $entry->to_array(), 200 );
	}

	/**
	 * Unmatch entry from transaction
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function unmatch_transaction( $request ) {
		$id = (int) $request->get_param( 'id' );

		// Check if entry exists.
		$entry = FinancialEntry::get_by_id( $id );
		if ( ! $entry ) {
			return new WP_Error(
				'rest_entry_not_found',
				__( 'Financial entry not found.', 'fair-payment' ),
				array( 'status' => 404 )
			);
		}

		$success = FinancialEntry::unmatch_transaction( $id );

		if ( ! $success ) {
			return new WP_Error(
				'rest_unmatch_failed',
				__( 'Failed to unmatch entry from transaction.', 'fair-payment' ),
				array( 'status' => 500 )
			);
		}

		$entry = FinancialEntry::get_by_id( $id );

		return new WP_REST_Response( $entry->to_array(), 200 );
	}

	/**
	 * Search transactions for matching
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function search_transactions( $request ) {
		$amount    = $request->get_param( 'amount' );
		$date_from = $request->get_param( 'date_from' );
		$date_to   = $request->get_param( 'date_to' );
		$search    = $request->get_param( 'search' );

		// Build filters for transaction search.
		$filters = array(
			'limit'  => 20,
			'status' => 'paid',
		);

		$transactions = Transaction::get_all( $filters );

		// Filter by amount if provided (with some tolerance).
		if ( ! empty( $amount ) ) {
			$tolerance    = 0.01;
			$transactions = array_filter(
				$transactions,
				function ( $t ) use ( $amount, $tolerance ) {
					return abs( (float) $t->amount - (float) $amount ) <= $tolerance;
				}
			);
		}

		// Filter by date range if provided.
		if ( ! empty( $date_from ) ) {
			$transactions = array_filter(
				$transactions,
				function ( $t ) use ( $date_from ) {
					return strtotime( $t->created_at ) >= strtotime( $date_from );
				}
			);
		}

		if ( ! empty( $date_to ) ) {
			$transactions = array_filter(
				$transactions,
				function ( $t ) use ( $date_to ) {
					return strtotime( $t->created_at ) <= strtotime( $date_to . ' 23:59:59' );
				}
			);
		}

		// Filter by search term if provided.
		if ( ! empty( $search ) ) {
			$search_lower = strtolower( $search );
			$transactions = array_filter(
				$transactions,
				function ( $t ) use ( $search_lower ) {
					return strpos( strtolower( $t->description ?? '' ), $search_lower ) !== false
						|| strpos( strtolower( $t->mollie_payment_id ?? '' ), $search_lower ) !== false;
				}
			);
		}

		$data = array_map(
			function ( $transaction ) {
				return array(
					'id'                => $transaction->id,
					'mollie_payment_id' => $transaction->mollie_payment_id,
					'amount'            => $transaction->amount,
					'currency'          => $transaction->currency,
					'status'            => $transaction->status,
					'description'       => $transaction->description,
					'created_at'        => $transaction->created_at,
				);
			},
			array_values( $transactions )
		);

		return new WP_REST_Response( $data, 200 );
	}

	/**
	 * Check permissions for getting items
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool True if user has permission.
	 */
	public function get_items_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}

	/**
	 * Check permissions for getting single item
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool True if user has permission.
	 */
	public function get_item_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}

	/**
	 * Check permissions for creating item
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool True if user has permission.
	 */
	public function create_item_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}

	/**
	 * Check permissions for updating item
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool True if user has permission.
	 */
	public function update_item_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}

	/**
	 * Check permissions for deleting item
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return bool True if user has permission.
	 */
	public function delete_item_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}
}
