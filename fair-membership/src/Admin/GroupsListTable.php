<?php
/**
 * Groups List Table for Fair Membership
 *
 * @package FairMembership
 */

namespace FairMembership\Admin;

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
			'cb'          => '<input type="checkbox" />',
			'name'        => __( 'Name', 'fair-membership' ),
			'description' => __( 'Description', 'fair-membership' ),
			'members'     => __( 'Members', 'fair-membership' ),
			'created'     => __( 'Created', 'fair-membership' ),
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
			'members' => array( 'members', false ),
			'created' => array( 'created', false ),
		);
	}

	/**
	 * Get bulk actions
	 *
	 * @return array
	 */
	public function get_bulk_actions() {
		return array(
			'delete' => __( 'Delete', 'fair-membership' ),
		);
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
		$total_items  = count( $this->get_sample_data() );

		$this->set_pagination_args(
			array(
				'total_items' => $total_items,
				'per_page'    => $per_page,
			)
		);

		$data = $this->get_sample_data();
		$data = array_slice( $data, ( ( $current_page - 1 ) * $per_page ), $per_page );

		$this->items = $data;
	}

	/**
	 * Default column display
	 *
	 * @param object $item Item data.
	 * @param string $column_name Column name.
	 * @return string
	 */
	public function column_default( $item, $column_name ) {
		switch ( $column_name ) {
			case 'description':
			case 'members':
			case 'created':
				return $item[ $column_name ];
			default:
				return print_r( $item, true );
		}
	}

	/**
	 * Checkbox column
	 *
	 * @param object $item Item data.
	 * @return string
	 */
	public function column_cb( $item ) {
		return sprintf(
			'<input type="checkbox" name="group[]" value="%s" />',
			$item['id']
		);
	}

	/**
	 * Name column with row actions
	 *
	 * @param object $item Item data.
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
				'<a href="?page=%s&action=%s&group=%s&_wpnonce=%s" onclick="return confirm(\'%s\')">%s</a>',
				esc_attr( $_REQUEST['page'] ),
				'delete',
				absint( $item['id'] ),
				$delete_nonce,
				__( 'Are you sure you want to delete this group?', 'fair-membership' ),
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
	 * @param object $item Item data.
	 * @return string
	 */
	public function column_members( $item ) {
		return sprintf(
			'<strong>%d</strong>',
			$item['members']
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
		if ( 'top' === $which ) {
			?>
			<div class="alignleft actions">
				<a href="<?php echo esc_url( admin_url( 'admin.php?page=fair-membership-group-view&action=add' ) ); ?>" class="button">
					<?php esc_html_e( 'Add New Group', 'fair-membership' ); ?>
				</a>
			</div>
			<?php
		}
	}

	/**
	 * Get sample data (placeholder until database tables are added)
	 *
	 * @return array
	 */
	private function get_sample_data() {
		return array(
			array(
				'id'          => 1,
				'name'        => 'Premium Members',
				'description' => 'Members with premium access to all features',
				'members'     => 25,
				'created'     => '2024-01-15',
			),
			array(
				'id'          => 2,
				'name'        => 'Event Organizers',
				'description' => 'Users who can create and manage events',
				'members'     => 12,
				'created'     => '2024-02-01',
			),
			array(
				'id'          => 3,
				'name'        => 'VIP Access',
				'description' => 'Special access group for VIP members',
				'members'     => 8,
				'created'     => '2024-02-20',
			),
			array(
				'id'          => 4,
				'name'        => 'Basic Users',
				'description' => 'Standard user access level',
				'members'     => 150,
				'created'     => '2024-01-01',
			),
			array(
				'id'          => 5,
				'name'        => 'Beta Testers',
				'description' => 'Users testing new features',
				'members'     => 45,
				'created'     => '2024-03-01',
			),
		);
	}
}