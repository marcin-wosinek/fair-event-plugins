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
				$this->groups_table->display();
				?>
			</form>
		</div>
		<?php
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