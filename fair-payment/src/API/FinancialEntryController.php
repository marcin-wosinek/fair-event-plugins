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

		// GET /fair-payment/v1/financial-entries/event-urls - Get distinct event URLs.
		register_rest_route(
			$this->namespace,
			'/financial-entries/event-urls',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_event_urls' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
				),
			)
		);

		// GET /fair-payment/v1/financial-entries/event-date-ids - Get distinct event date IDs.
		register_rest_route(
			$this->namespace,
			'/financial-entries/event-date-ids',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_event_date_ids' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
				),
			)
		);

		// POST /fair-payment/v1/financial-entries/transfer - Create transfer.
		// PUT /fair-payment/v1/financial-entries/transfer/{id} - Update transfer.
		register_rest_route(
			$this->namespace,
			'/financial-entries/transfer',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_transfer' ),
					'permission_callback' => array( $this, 'create_item_permissions_check' ),
					'args'                => $this->get_transfer_args(),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/financial-entries/transfer/(?P<id>\d+)',
			array(
				array(
					'methods'             => WP_REST_Server::EDITABLE,
					'callback'            => array( $this, 'update_transfer' ),
					'permission_callback' => array( $this, 'update_item_permissions_check' ),
					'args'                => array_merge(
						array(
							'id' => array(
								'description' => __( 'Unique identifier for the transfer entry.', 'fair-payment' ),
								'type'        => 'integer',
							),
						),
						$this->get_transfer_args()
					),
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

		// POST /fair-payment/v1/financial-entries/{id}/split - Split entry into multiple budgets.
		// PUT /fair-payment/v1/financial-entries/{id}/split - Update an existing split.
		// DELETE /fair-payment/v1/financial-entries/{id}/split - Unsplit entry.
		register_rest_route(
			$this->namespace,
			'/financial-entries/(?P<id>\d+)/split',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'split_entry' ),
					'permission_callback' => array( $this, 'update_item_permissions_check' ),
					'args'                => $this->get_split_args(),
				),
				array(
					'methods'             => WP_REST_Server::EDITABLE,
					'callback'            => array( $this, 'update_split_entry' ),
					'permission_callback' => array( $this, 'update_item_permissions_check' ),
					'args'                => $this->get_split_args(),
				),
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'unsplit_entry' ),
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

		// POST /fair-payment/v1/financial-entries/import - Import entries from parsed data.
		register_rest_route(
			$this->namespace,
			'/financial-entries/import',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'import_entries' ),
					'permission_callback' => array( $this, 'create_item_permissions_check' ),
					'args'                => array(
						'entries'       => array(
							'description' => __( 'Array of entries to import.', 'fair-payment' ),
							'type'        => 'array',
							'required'    => true,
							'items'       => array(
								'type'       => 'object',
								'properties' => array(
									'amount'             => array(
										'type'     => 'number',
										'required' => true,
									),
									'entry_type'         => array(
										'type'     => 'string',
										'required' => true,
									),
									'entry_date'         => array(
										'type'     => 'string',
										'required' => true,
									),
									'description'        => array(
										'type' => 'string',
									),
									'external_reference' => array(
										'type'     => 'string',
										'required' => true,
									),
								),
							),
						),
						'import_source' => array(
							'description'       => __( 'Source filename of the import.', 'fair-payment' ),
							'type'              => 'string',
							'required'          => false,
							'sanitize_callback' => 'sanitize_file_name',
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
			'date_from'     => array(
				'description'       => __( 'Filter by start date (Y-m-d format).', 'fair-payment' ),
				'type'              => 'string',
				'format'            => 'date',
				'sanitize_callback' => 'sanitize_text_field',
			),
			'date_to'       => array(
				'description'       => __( 'Filter by end date (Y-m-d format).', 'fair-payment' ),
				'type'              => 'string',
				'format'            => 'date',
				'sanitize_callback' => 'sanitize_text_field',
			),
			'budget_id'     => array(
				'description'       => __( 'Filter by budget ID, or "none" for unbudgeted.', 'fair-payment' ),
				'type'              => 'string',
				'sanitize_callback' => 'sanitize_text_field',
			),
			'event_url'     => array(
				'description'       => __( 'Filter by event URL.', 'fair-payment' ),
				'type'              => 'string',
				'sanitize_callback' => 'sanitize_text_field',
			),
			'event_date_id' => array(
				'description' => __( 'Filter by event date ID.', 'fair-payment' ),
				'type'        => 'integer',
			),
			'entry_type'    => array(
				'description'       => __( 'Filter by entry type: cost, income, or transfer.', 'fair-payment' ),
				'type'              => 'string',
				'enum'              => array( 'cost', 'income', 'transfer' ),
				'sanitize_callback' => 'sanitize_text_field',
			),
			'unmatched'     => array(
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
				'orderby'  => array(
					'description'       => __( 'Sort by column.', 'fair-payment' ),
					'type'              => 'string',
					'default'           => 'entry_date',
					'enum'              => array( 'entry_date', 'amount', 'budget_id', 'event_date_id', 'imported_at' ),
					'sanitize_callback' => 'sanitize_text_field',
				),
				'order'    => array(
					'description'       => __( 'Sort direction.', 'fair-payment' ),
					'type'              => 'string',
					'default'           => 'desc',
					'enum'              => array( 'asc', 'desc' ),
					'sanitize_callback' => 'sanitize_text_field',
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
				'type'        => array( 'integer', 'null' ),
				'required'    => false,
			),
			'transaction_id' => array(
				'description' => __( 'Transaction ID.', 'fair-payment' ),
				'type'        => 'integer',
				'required'    => false,
			),
			'event_url'      => array(
				'description'       => __( 'Event URL (local or external).', 'fair-payment' ),
				'type'              => array( 'string', 'null' ),
				'required'          => false,
				'sanitize_callback' => function ( $value ) {
					return $value ? esc_url_raw( $value ) : null;
				},
			),
			'event_date_id'  => array(
				'description' => __( 'Event date ID.', 'fair-payment' ),
				'type'        => array( 'integer', 'null' ),
				'required'    => false,
			),
		);
	}

	/**
	 * Get arguments for split endpoints (POST and PUT)
	 *
	 * @return array Arguments definition.
	 */
	private function get_split_args() {
		return array(
			'id'          => array(
				'description' => __( 'Unique identifier for the financial entry.', 'fair-payment' ),
				'type'        => 'integer',
			),
			'allocations' => array(
				'description' => __( 'Array of budget allocations.', 'fair-payment' ),
				'type'        => 'array',
				'required'    => true,
				'items'       => array(
					'type'       => 'object',
					'properties' => array(
						'budget_id'     => array(
							'type' => array( 'integer', 'null' ),
						),
						'amount'        => array(
							'type'     => 'number',
							'required' => true,
						),
						'description'   => array(
							'type' => 'string',
						),
						'event_url'     => array(
							'type' => array( 'string', 'null' ),
						),
						'event_date_id' => array(
							'type' => array( 'integer', 'null' ),
						),
					),
				),
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
			'date_from'     => $request->get_param( 'date_from' ),
			'date_to'       => $request->get_param( 'date_to' ),
			'budget_id'     => $request->get_param( 'budget_id' ),
			'event_url'     => $request->get_param( 'event_url' ),
			'event_date_id' => $request->get_param( 'event_date_id' ),
			'entry_type'    => $request->get_param( 'entry_type' ),
			'unmatched'     => $request->get_param( 'unmatched' ),
			'per_page'      => $request->get_param( 'per_page' ),
			'page'          => $request->get_param( 'page' ),
			'orderby'       => $request->get_param( 'orderby' ),
			'order'         => $request->get_param( 'order' ),
		);

		$result = FinancialEntry::get_filtered( $filters );

		$data = array(
			'entries' => array_map(
				function ( $entry ) {
					$entry_data = $entry->to_array();

					if ( $entry->parent_entry_id ) {
						// This is a child entry (shown due to budget filter).
						// Include parent with all children for Edit Split functionality.
						$parent = FinancialEntry::get_by_id( $entry->parent_entry_id );
						if ( $parent ) {
							$parent_data             = $parent->to_array();
							$parent_data['children'] = array_map(
								function ( $child ) {
									return $child->to_array();
								},
								FinancialEntry::get_children( $parent->id )
							);
							$entry_data['parent'] = $parent_data;
						}
					} else {
						// Include children for split parent entries.
						$children = FinancialEntry::get_children( $entry->id );
						if ( ! empty( $children ) ) {
							$entry_data['children'] = array_map(
								function ( $child ) {
									return $child->to_array();
								},
								$children
							);
						}
					}

					return $entry_data;
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
			'date_from'     => $request->get_param( 'date_from' ),
			'date_to'       => $request->get_param( 'date_to' ),
			'budget_id'     => $request->get_param( 'budget_id' ),
			'event_url'     => $request->get_param( 'event_url' ),
			'event_date_id' => $request->get_param( 'event_date_id' ),
			'unmatched'     => $request->get_param( 'unmatched' ),
		);

		$totals = FinancialEntry::get_totals( $filters );

		return new WP_REST_Response( $totals, 200 );
	}

	/**
	 * Get distinct event URLs used in entries
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response Response object.
	 */
	public function get_event_urls( $request ) {
		$urls = FinancialEntry::get_distinct_event_urls();

		return new WP_REST_Response( $urls, 200 );
	}

	/**
	 * Get distinct event date IDs used in entries
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response Response object.
	 */
	public function get_event_date_ids( $request ) {
		$ids = FinancialEntry::get_distinct_event_date_ids();

		return new WP_REST_Response( $ids, 200 );
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
		$event_url      = $request->get_param( 'event_url' );
		$event_date_id  = $request->get_param( 'event_date_id' );

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
			! empty( $transaction_id ) ? $transaction_id : null,
			! empty( $event_url ) ? $event_url : null,
			! empty( $event_date_id ) ? $event_date_id : null
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
		$event_url      = $request->get_param( 'event_url' );
		$event_date_id  = $request->get_param( 'event_date_id' );

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
			! empty( $transaction_id ) ? $transaction_id : null,
			! empty( $event_url ) ? $event_url : null,
			! empty( $event_date_id ) ? $event_date_id : null
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
	 * Split entry into multiple budget allocations
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function split_entry( $request ) {
		$id          = (int) $request->get_param( 'id' );
		$allocations = $request->get_param( 'allocations' );

		// Check if entry exists.
		$entry = FinancialEntry::get_by_id( $id );
		if ( ! $entry ) {
			return new WP_Error(
				'rest_entry_not_found',
				__( 'Financial entry not found.', 'fair-payment' ),
				array( 'status' => 404 )
			);
		}

		// Cannot split a child entry.
		if ( $entry->parent_entry_id ) {
			return new WP_Error(
				'rest_entry_is_child',
				__( 'Cannot split a child entry.', 'fair-payment' ),
				array( 'status' => 400 )
			);
		}

		// Cannot split an already-split entry.
		if ( FinancialEntry::has_children( $id ) ) {
			return new WP_Error(
				'rest_entry_already_split',
				__( 'Entry is already split.', 'fair-payment' ),
				array( 'status' => 400 )
			);
		}

		// Validate allocations.
		if ( empty( $allocations ) || ! is_array( $allocations ) || count( $allocations ) < 2 ) {
			return new WP_Error(
				'rest_invalid_allocations',
				__( 'At least 2 allocations are required.', 'fair-payment' ),
				array( 'status' => 400 )
			);
		}

		$total_allocated = 0;
		foreach ( $allocations as $allocation ) {
			if ( empty( $allocation['amount'] ) || (float) $allocation['amount'] <= 0 ) {
				return new WP_Error(
					'rest_invalid_allocation_amount',
					__( 'Each allocation amount must be greater than zero.', 'fair-payment' ),
					array( 'status' => 400 )
				);
			}
			$total_allocated += (float) $allocation['amount'];
		}

		// Check total matches original (with 0.01 tolerance).
		if ( abs( $total_allocated - $entry->amount ) > 0.01 ) {
			return new WP_Error(
				'rest_allocation_mismatch',
				__( 'Total allocations must match the original entry amount.', 'fair-payment' ),
				array( 'status' => 400 )
			);
		}

		$child_ids = FinancialEntry::split_entry( $id, $allocations );

		if ( ! $child_ids ) {
			return new WP_Error(
				'rest_split_failed',
				__( 'Failed to split entry.', 'fair-payment' ),
				array( 'status' => 500 )
			);
		}

		$children = FinancialEntry::get_children( $id );

		return new WP_REST_Response(
			array(
				'parent'   => $entry->to_array(),
				'children' => array_map(
					function ( $child ) {
						return $child->to_array();
					},
					$children
				),
			),
			201
		);
	}

	/**
	 * Update an existing split entry's allocations
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function update_split_entry( $request ) {
		$id          = (int) $request->get_param( 'id' );
		$allocations = $request->get_param( 'allocations' );

		// Check if entry exists.
		$entry = FinancialEntry::get_by_id( $id );
		if ( ! $entry ) {
			return new WP_Error(
				'rest_entry_not_found',
				__( 'Financial entry not found.', 'fair-payment' ),
				array( 'status' => 404 )
			);
		}

		// Cannot update split on a child entry.
		if ( $entry->parent_entry_id ) {
			return new WP_Error(
				'rest_entry_is_child',
				__( 'Cannot update split on a child entry.', 'fair-payment' ),
				array( 'status' => 400 )
			);
		}

		// Must already be split.
		if ( ! FinancialEntry::has_children( $id ) ) {
			return new WP_Error(
				'rest_entry_not_split',
				__( 'Entry is not split.', 'fair-payment' ),
				array( 'status' => 400 )
			);
		}

		// Validate allocations.
		if ( empty( $allocations ) || ! is_array( $allocations ) || count( $allocations ) < 2 ) {
			return new WP_Error(
				'rest_invalid_allocations',
				__( 'At least 2 allocations are required.', 'fair-payment' ),
				array( 'status' => 400 )
			);
		}

		$total_allocated = 0;
		foreach ( $allocations as $allocation ) {
			if ( empty( $allocation['amount'] ) || (float) $allocation['amount'] <= 0 ) {
				return new WP_Error(
					'rest_invalid_allocation_amount',
					__( 'Each allocation amount must be greater than zero.', 'fair-payment' ),
					array( 'status' => 400 )
				);
			}
			$total_allocated += (float) $allocation['amount'];
		}

		// Check total matches original (with 0.01 tolerance).
		if ( abs( $total_allocated - $entry->amount ) > 0.01 ) {
			return new WP_Error(
				'rest_allocation_mismatch',
				__( 'Total allocations must match the original entry amount.', 'fair-payment' ),
				array( 'status' => 400 )
			);
		}

		$child_ids = FinancialEntry::update_split( $id, $allocations );

		if ( ! $child_ids ) {
			return new WP_Error(
				'rest_update_split_failed',
				__( 'Failed to update split.', 'fair-payment' ),
				array( 'status' => 500 )
			);
		}

		$children = FinancialEntry::get_children( $id );

		return new WP_REST_Response(
			array(
				'parent'   => $entry->to_array(),
				'children' => array_map(
					function ( $child ) {
						return $child->to_array();
					},
					$children
				),
			),
			200
		);
	}

	/**
	 * Unsplit entry (delete all child entries)
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function unsplit_entry( $request ) {
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

		// Check it actually has children.
		if ( ! FinancialEntry::has_children( $id ) ) {
			return new WP_Error(
				'rest_entry_not_split',
				__( 'Entry is not split.', 'fair-payment' ),
				array( 'status' => 400 )
			);
		}

		$success = FinancialEntry::unsplit_entry( $id );

		if ( ! $success ) {
			return new WP_Error(
				'rest_unsplit_failed',
				__( 'Failed to unsplit entry.', 'fair-payment' ),
				array( 'status' => 500 )
			);
		}

		return new WP_REST_Response( $entry->to_array(), 200 );
	}

	/**
	 * Get arguments for transfer endpoints
	 *
	 * @return array Arguments definition.
	 */
	private function get_transfer_args() {
		return array(
			'amount'           => array(
				'description' => __( 'Transfer amount (positive value).', 'fair-payment' ),
				'type'        => 'number',
				'required'    => true,
			),
			'entry_date'       => array(
				'description'       => __( 'Transfer date (Y-m-d format).', 'fair-payment' ),
				'type'              => 'string',
				'required'          => true,
				'format'            => 'date',
				'sanitize_callback' => 'sanitize_text_field',
			),
			'source_budget_id' => array(
				'description' => __( 'Source budget ID (money comes from).', 'fair-payment' ),
				'type'        => 'integer',
				'required'    => true,
			),
			'target_budget_id' => array(
				'description' => __( 'Target budget ID (money goes to).', 'fair-payment' ),
				'type'        => 'integer',
				'required'    => true,
			),
			'description'      => array(
				'description'       => __( 'Transfer description.', 'fair-payment' ),
				'type'              => 'string',
				'required'          => false,
				'sanitize_callback' => 'sanitize_textarea_field',
			),
			'event_url'        => array(
				'description'       => __( 'Event URL (local or external).', 'fair-payment' ),
				'type'              => array( 'string', 'null' ),
				'required'          => false,
				'sanitize_callback' => function ( $value ) {
					return $value ? esc_url_raw( $value ) : null;
				},
			),
			'event_date_id'    => array(
				'description' => __( 'Event date ID.', 'fair-payment' ),
				'type'        => array( 'integer', 'null' ),
				'required'    => false,
			),
		);
	}

	/**
	 * Create a transfer between budgets
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function create_transfer( $request ) {
		$amount           = $request->get_param( 'amount' );
		$entry_date       = $request->get_param( 'entry_date' );
		$source_budget_id = $request->get_param( 'source_budget_id' );
		$target_budget_id = $request->get_param( 'target_budget_id' );
		$description      = $request->get_param( 'description' );
		$event_url        = $request->get_param( 'event_url' );
		$event_date_id    = $request->get_param( 'event_date_id' );

		if ( empty( $amount ) || $amount <= 0 ) {
			return new WP_Error(
				'rest_invalid_amount',
				__( 'Amount must be greater than zero.', 'fair-payment' ),
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

		if ( empty( $source_budget_id ) || empty( $target_budget_id ) ) {
			return new WP_Error(
				'rest_invalid_budgets',
				__( 'Both source and target budgets are required.', 'fair-payment' ),
				array( 'status' => 400 )
			);
		}

		if ( (int) $source_budget_id === (int) $target_budget_id ) {
			return new WP_Error(
				'rest_same_budget',
				__( 'Source and target budgets must be different.', 'fair-payment' ),
				array( 'status' => 400 )
			);
		}

		$parent_id = FinancialEntry::create_transfer(
			$amount,
			$entry_date,
			$source_budget_id,
			$target_budget_id,
			$description,
			! empty( $event_url ) ? $event_url : null,
			! empty( $event_date_id ) ? $event_date_id : null
		);

		if ( ! $parent_id ) {
			return new WP_Error(
				'rest_transfer_creation_failed',
				__( 'Failed to create transfer.', 'fair-payment' ),
				array( 'status' => 500 )
			);
		}

		$entry    = FinancialEntry::get_by_id( $parent_id );
		$children = FinancialEntry::get_children( $parent_id );

		$entry_data             = $entry->to_array();
		$entry_data['children'] = array_map(
			function ( $child ) {
				return $child->to_array();
			},
			$children
		);

		return new WP_REST_Response( $entry_data, 201 );
	}

	/**
	 * Update an existing transfer
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function update_transfer( $request ) {
		$id               = (int) $request->get_param( 'id' );
		$amount           = $request->get_param( 'amount' );
		$entry_date       = $request->get_param( 'entry_date' );
		$source_budget_id = $request->get_param( 'source_budget_id' );
		$target_budget_id = $request->get_param( 'target_budget_id' );
		$description      = $request->get_param( 'description' );
		$event_url        = $request->get_param( 'event_url' );
		$event_date_id    = $request->get_param( 'event_date_id' );

		// Check if entry exists and is a transfer.
		$existing = FinancialEntry::get_by_id( $id );
		if ( ! $existing ) {
			return new WP_Error(
				'rest_entry_not_found',
				__( 'Transfer entry not found.', 'fair-payment' ),
				array( 'status' => 404 )
			);
		}

		if ( 'transfer' !== $existing->entry_type ) {
			return new WP_Error(
				'rest_not_a_transfer',
				__( 'Entry is not a transfer.', 'fair-payment' ),
				array( 'status' => 400 )
			);
		}

		if ( empty( $amount ) || $amount <= 0 ) {
			return new WP_Error(
				'rest_invalid_amount',
				__( 'Amount must be greater than zero.', 'fair-payment' ),
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

		if ( empty( $source_budget_id ) || empty( $target_budget_id ) ) {
			return new WP_Error(
				'rest_invalid_budgets',
				__( 'Both source and target budgets are required.', 'fair-payment' ),
				array( 'status' => 400 )
			);
		}

		if ( (int) $source_budget_id === (int) $target_budget_id ) {
			return new WP_Error(
				'rest_same_budget',
				__( 'Source and target budgets must be different.', 'fair-payment' ),
				array( 'status' => 400 )
			);
		}

		$success = FinancialEntry::update_transfer(
			$id,
			$amount,
			$entry_date,
			$source_budget_id,
			$target_budget_id,
			$description,
			! empty( $event_url ) ? $event_url : null,
			! empty( $event_date_id ) ? $event_date_id : null
		);

		if ( ! $success ) {
			return new WP_Error(
				'rest_transfer_update_failed',
				__( 'Failed to update transfer.', 'fair-payment' ),
				array( 'status' => 500 )
			);
		}

		$entry    = FinancialEntry::get_by_id( $id );
		$children = FinancialEntry::get_children( $id );

		$entry_data             = $entry->to_array();
		$entry_data['children'] = array_map(
			function ( $child ) {
				return $child->to_array();
			},
			$children
		);

		return new WP_REST_Response( $entry_data, 200 );
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
	 * Import entries from parsed data
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error Response object on success, or WP_Error on failure.
	 */
	public function import_entries( $request ) {
		$entries       = $request->get_param( 'entries' );
		$import_source = $request->get_param( 'import_source' );

		if ( empty( $entries ) || ! is_array( $entries ) ) {
			return new WP_Error(
				'rest_invalid_entries',
				__( 'No entries provided for import.', 'fair-payment' ),
				array( 'status' => 400 )
			);
		}

		$imported = 0;
		$skipped  = 0;
		$errors   = array();

		foreach ( $entries as $index => $entry_data ) {
			// Validate required fields.
			if ( empty( $entry_data['amount'] ) || empty( $entry_data['entry_type'] ) ||
				empty( $entry_data['entry_date'] ) || empty( $entry_data['external_reference'] ) ) {
				++$skipped;
				$errors[] = sprintf(
					/* translators: %d: row number */
					__( 'Row %d: Missing required fields.', 'fair-payment' ),
					$index + 1
				);
				continue;
			}

			// Validate entry_type.
			if ( ! in_array( $entry_data['entry_type'], array( 'cost', 'income' ), true ) ) {
				++$skipped;
				$errors[] = sprintf(
					/* translators: %d: row number */
					__( 'Row %d: Invalid entry type.', 'fair-payment' ),
					$index + 1
				);
				continue;
			}

			// Try to create the entry (will skip if external_reference exists).
			$entry_id = FinancialEntry::create_with_external_reference(
				abs( (float) $entry_data['amount'] ),
				$entry_data['entry_type'],
				sanitize_text_field( $entry_data['entry_date'] ),
				sanitize_text_field( $entry_data['external_reference'] ),
				isset( $entry_data['description'] ) ? sanitize_textarea_field( $entry_data['description'] ) : null,
				null, // No budget_id for imports.
				$import_source
			);

			if ( $entry_id ) {
				++$imported;
			} else {
				++$skipped;
			}
		}

		return new WP_REST_Response(
			array(
				'imported' => $imported,
				'skipped'  => $skipped,
				'errors'   => $errors,
				'message'  => sprintf(
					/* translators: 1: imported count, 2: skipped count */
					__( 'Imported %1$d entries, skipped %2$d (duplicates or errors).', 'fair-payment' ),
					$imported,
					$skipped
				),
			),
			200
		);
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
