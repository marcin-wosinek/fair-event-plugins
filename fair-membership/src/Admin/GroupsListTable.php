<?php
/**
 * Groups List Table for Fair Membership
 *
 * @package FairMembership
 */

namespace FairMembership\Admin;

use FairMembership\Models\Group;

defined( 'WPINC' ) || die;

if ( ! class_exists( 'WP_List_Table' ) ) {
	require_once ABSPATH . 'wp-admin/includes/class-wp-list-table.php';
}

/**
 * Groups list table extending WP_List_Table
 */
class GroupsListTable extends \WP_List_Table {

	/**
	 * Constructor
	 */
	public function __construct() {
		parent::__construct(
			array(
				'singular' => 'group',
				'plural'   => 'groups',
				'ajax'     => false,
			)
		);
	}

	/**
	 * Get columns for the table
	 *
	 * @return array
	 */
	public function get_columns() {
		return array(
			'name'           => __( 'Name', 'fair-membership' ),
			'description'    => __( 'Description', 'fair-membership' ),
			'access_control' => __( 'Access', 'fair-membership' ),
			'members'        => __( 'Members', 'fair-membership' ),
			'created'        => __( 'Created', 'fair-membership' ),
		);
	}

	/**
	 * Get sortable columns
	 *
	 * @return array
	 */
	public function get_sortable_columns() {
		return array(
			'name'    => array( 'name', true ),
			'created' => array( 'created', false ),
		);
	}

	/**
	 * Get bulk actions
	 *
	 * @return array
	 */
	public function get_bulk_actions() {
		return array();
	}

	/**
	 * Prepare items for display
	 *
	 * @return void
	 */
	public function prepare_items() {
		$columns  = $this->get_columns();
		$hidden   = array();
		$sortable = $this->get_sortable_columns();

		$this->_column_headers = array( $columns, $hidden, $sortable );

		$per_page     = 20;
		$current_page = $this->get_pagenum();
		$total_items  = Group::count();

		$this->set_pagination_args(
			array(
				'total_items' => $total_items,
				'per_page'    => $per_page,
			)
		);

		// Get sorting parameters
		$orderby = ! empty( $_REQUEST['orderby'] ) ? sanitize_text_field( $_REQUEST['orderby'] ) : 'name';
		$order   = ! empty( $_REQUEST['order'] ) && 'desc' === strtolower( $_REQUEST['order'] ) ? 'DESC' : 'ASC';

		// Map column names to database fields
		$orderby_map = array(
			'name'    => 'name',
			'created' => 'created_at',
		);

		$orderby = isset( $orderby_map[ $orderby ] ) ? $orderby_map[ $orderby ] : 'name';

		$groups = Group::get_all(
			array(
				'orderby' => $orderby,
				'order'   => $order,
				'limit'   => $per_page,
				'offset'  => ( $current_page - 1 ) * $per_page,
			)
		);

		// Convert Group objects to array format for table display
		$items = array();
		foreach ( $groups as $group ) {
			$items[] = $this->prepare_group_item( $group );
		}

		$this->items = $items;
	}

	/**
	 * Default column display
	 *
	 * @param array  $item Item data.
	 * @param string $column_name Column name.
	 * @return string
	 */
	public function column_default( $item, $column_name ) {
		switch ( $column_name ) {
			case 'description':
				return ! empty( $item['description'] ) ? esc_html( $item['description'] ) : '<em>' . __( 'No description', 'fair-membership' ) . '</em>';
			case 'members':
				return $item['members'];
			case 'created':
				return $item['created'];
			case 'access_control':
				return $this->format_access_control( $item['access_control'] );
			default:
				return print_r( $item, true );
		}
	}


	/**
	 * Name column with row actions
	 *
	 * @param array $item Item data.
	 * @return string
	 */
	public function column_name( $item ) {
		$delete_nonce = wp_create_nonce( 'fair_membership_delete_group' );

		$actions = array(
			'view'   => sprintf(
				'<a href="?page=%s&id=%s">%s</a>',
				'fair-membership-group-view',
				absint( $item['id'] ),
				__( 'View', 'fair-membership' )
			),
			'edit'   => sprintf(
				'<a href="?page=%s&id=%s&action=%s">%s</a>',
				'fair-membership-group-view',
				absint( $item['id'] ),
				'edit',
				__( 'Edit', 'fair-membership' )
			),
			'delete' => sprintf(
				'<a href="?page=%s&action=%s&id=%s&_wpnonce=%s">%s</a>',
				'fair-membership-group-view',
				'delete',
				absint( $item['id'] ),
				$delete_nonce,
				__( 'Delete', 'fair-membership' )
			),
		);

		return sprintf(
			'<strong><a href="?page=%s&id=%s">%s</a></strong>%s',
			'fair-membership-group-view',
			absint( $item['id'] ),
			$item['name'],
			$this->row_actions( $actions )
		);
	}

	/**
	 * Members column with formatting
	 *
	 * @param array $item Item data.
	 * @return string
	 */
	public function column_members( $item ) {
		return sprintf(
			'<strong>%d</strong>',
			$item['members']
		);
	}

	/**
	 * Format access control value for display
	 *
	 * @param string $access_control Access control value.
	 * @return string
	 */
	private function format_access_control( $access_control ) {
		$labels = array(
			'open'    => __( 'Open', 'fair-membership' ),
			'managed' => __( 'Managed', 'fair-membership' ),
		);

		$label = isset( $labels[ $access_control ] ) ? $labels[ $access_control ] : $access_control;

		return sprintf(
			'<span class="access-control-badge access-control-%s">%s</span>',
			esc_attr( $access_control ),
			esc_html( $label )
		);
	}

	/**
	 * Display when no items found
	 *
	 * @return void
	 */
	public function no_items() {
		esc_html_e( 'No groups found.', 'fair-membership' );
	}

	/**
	 * Extra controls for the table navigation
	 *
	 * @param string $which Position of the navigation.
	 * @return void
	 */
	protected function extra_tablenav( $which ) {
		// No extra controls needed
	}

	/**
	 * Prepare a Group model for table display
	 *
	 * @param Group $group Group model instance.
	 * @return array
	 */
	private function prepare_group_item( $group ) {
		return array(
			'id'             => $group->id,
			'name'           => $group->name,
			'description'    => $group->description,
			'access_control' => $group->access_control,
			'members'        => 0, // TODO: Implement member count when membership table exists
			'created'        => mysql2date( get_option( 'date_format' ), $group->created_at ),
		);
	}
}
