<?php
/**
 * Groups list admin page for Fair Membership
 *
 * @package FairMembership
 */

namespace FairMembership\Admin;

defined( 'WPINC' ) || die;

/**
 * Handles the groups list admin page using WordPress components
 */
class GroupsListPage {

	/**
	 * Groups list table instance
	 *
	 * @var GroupsListTable
	 */
	private $groups_table;

	/**
	 * Constructor
	 */
	public function __construct() {
		$this->groups_table = new GroupsListTable();
	}

	/**
	 * Render the groups list page
	 *
	 * @return void
	 */
	public function render() {
		$this->process_bulk_actions();

		?>
		<div class="wrap">
			<h1 class="wp-heading-inline">
				<?php esc_html_e( 'Groups', 'fair-membership' ); ?>
			</h1>
			<a href="<?php echo esc_url( admin_url( 'admin.php?page=fair-membership-group-view&action=add' ) ); ?>" class="page-title-action">
				<?php esc_html_e( 'Add New', 'fair-membership' ); ?>
			</a>
			<hr class="wp-header-end">

			<?php $this->display_admin_notices(); ?>

			<form id="groups-filter" method="get">
				<input type="hidden" name="page" value="<?php echo esc_attr( $_REQUEST['page'] ); ?>" />
				<?php
				$this->groups_table->prepare_items();
				$this->groups_table->search_box( __( 'Search Groups', 'fair-membership' ), 'group' );
				$this->groups_table->display();
				?>
			</form>
		</div>
		<?php
	}

	/**
	 * Process bulk actions
	 *
	 * @return void
	 */
	private function process_bulk_actions() {
		$action = $this->groups_table->current_action();

		if ( ! $action ) {
			return;
		}

		// Verify nonce for security
		if ( ! isset( $_REQUEST['_wpnonce'] ) || ! wp_verify_nonce( $_REQUEST['_wpnonce'], 'fair_membership_delete_group' ) ) {
			return;
		}

		switch ( $action ) {
			case 'delete':
				if ( isset( $_REQUEST['group'] ) ) {
					$group_ids = is_array( $_REQUEST['group'] ) ? $_REQUEST['group'] : array( $_REQUEST['group'] );
					$this->delete_groups( $group_ids );
				}
				break;
		}

		// Redirect to avoid resubmission
		wp_redirect( admin_url( 'admin.php?page=fair-membership&deleted=' . count( $group_ids ) ) );
		exit;
	}

	/**
	 * Delete groups (placeholder for actual deletion)
	 *
	 * @param array $group_ids Group IDs to delete.
	 * @return void
	 */
	private function delete_groups( $group_ids ) {
		// Placeholder: In real implementation, delete from database
		foreach ( $group_ids as $group_id ) {
			// delete_group_from_database( $group_id );
		}
	}

	/**
	 * Display admin notices
	 *
	 * @return void
	 */
	private function display_admin_notices() {
		if ( isset( $_GET['deleted'] ) && $_GET['deleted'] > 0 ) {
			$count = intval( $_GET['deleted'] );
			?>
			<div class="notice notice-success is-dismissible">
				<p>
					<?php
					echo esc_html(
						sprintf(
							// translators: %d is the number of groups deleted.
							_n(
								'%d group deleted successfully.',
								'%d groups deleted successfully.',
								$count,
								'fair-membership'
							),
							$count
						)
					);
					?>
				</p>
			</div>
			<?php
		}

		if ( isset( $_GET['added'] ) && $_GET['added'] ) {
			?>
			<div class="notice notice-success is-dismissible">
				<p><?php esc_html_e( 'Group added successfully.', 'fair-membership' ); ?></p>
			</div>
			<?php
		}

		if ( isset( $_GET['updated'] ) && $_GET['updated'] ) {
			?>
			<div class="notice notice-success is-dismissible">
				<p><?php esc_html_e( 'Group updated successfully.', 'fair-membership' ); ?></p>
			</div>
			<?php
		}
	}
}