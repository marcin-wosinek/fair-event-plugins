<?php
/**
 * Group view admin page for Fair Membership
 *
 * @package FairMembership
 */

namespace FairMembership\Admin;

defined( 'WPINC' ) || die;

/**
 * Handles the individual group view/edit admin page using WordPress components
 */
class GroupViewPage {

	/**
	 * Render the group view/edit page
	 *
	 * @return void
	 */
	public function render() {
		$group_id = isset( $_GET['id'] ) ? intval( $_GET['id'] ) : 0;
		$action   = isset( $_GET['action'] ) ? sanitize_text_field( $_GET['action'] ) : 'view';

		// Handle form submissions first
		if ( $_SERVER['REQUEST_METHOD'] === 'POST' ) {
			$this->handle_form_submission( $group_id, $action );
			return;
		}

		if ( 'add' === $action ) {
			$this->render_add_group_page();
		} elseif ( $group_id && 'edit' === $action ) {
			$this->render_edit_group_page( $group_id );
		} elseif ( $group_id ) {
			$this->render_view_group_page( $group_id );
		} else {
			$this->render_group_not_found();
		}
	}

	/**
	 * Handle form submissions
	 *
	 * @param int    $group_id Group ID.
	 * @param string $action Current action.
	 * @return void
	 */
	private function handle_form_submission( $group_id, $action ) {
		$mode = ( 'add' === $action ) ? 'add' : 'edit';
		$form = new GroupForm( array(), $mode );

		$result = $form->process_submission();

		if ( $result && $result['success'] ) {
			wp_redirect( $result['redirect'] );
			exit;
		}

		// If we get here, there was an error - continue to display the form
		if ( 'add' === $action ) {
			$this->render_add_group_page();
		} else {
			$this->render_edit_group_page( $group_id );
		}
	}

	/**
	 * Render add new group page
	 *
	 * @return void
	 */
	private function render_add_group_page() {
		?>
		<div class="wrap">
			<h1 class="wp-heading-inline"><?php esc_html_e( 'Add New Group', 'fair-membership' ); ?></h1>
			<hr class="wp-header-end">

			<?php GroupForm::display_errors(); ?>

			<?php
			$form = new GroupForm( array(), 'add' );
			$form->render();
			?>

			<p>
				<a href="<?php echo esc_url( admin_url( 'admin.php?page=fair-membership' ) ); ?>" class="button">
					&larr; <?php esc_html_e( 'Back to Groups', 'fair-membership' ); ?>
				</a>
			</p>
		</div>
		<?php
	}

	/**
	 * Render edit group page
	 *
	 * @param int $group_id Group ID to edit.
	 * @return void
	 */
	private function render_edit_group_page( $group_id ) {
		$group = $this->get_sample_group( $group_id );

		if ( ! $group ) {
			$this->render_group_not_found();
			return;
		}
		?>
		<div class="wrap">
			<h1 class="wp-heading-inline">
				<?php echo esc_html( sprintf( __( 'Edit Group: %s', 'fair-membership' ), $group['name'] ) ); ?>
			</h1>
			<hr class="wp-header-end">

			<?php $this->display_edit_notices(); ?>
			<?php GroupForm::display_errors(); ?>

			<?php
			$form = new GroupForm( $group, 'edit' );
			$form->render();
			?>

			<p>
				<a href="<?php echo esc_url( admin_url( 'admin.php?page=fair-membership-group-view&id=' . $group_id ) ); ?>" class="button">
					&larr; <?php esc_html_e( 'Back to Group View', 'fair-membership' ); ?>
				</a>
			</p>
		</div>
		<?php
	}

	/**
	 * Render view group page
	 *
	 * @param int $group_id Group ID to view.
	 * @return void
	 */
	private function render_view_group_page( $group_id ) {
		$group = $this->get_sample_group( $group_id );

		if ( ! $group ) {
			$this->render_group_not_found();
			return;
		}
		?>
		<div class="wrap">
			<h1 class="wp-heading-inline">
				<?php echo esc_html( $group['name'] ); ?>
			</h1>
			<a href="<?php echo esc_url( admin_url( 'admin.php?page=fair-membership-group-view&id=' . $group_id . '&action=edit' ) ); ?>" class="page-title-action">
				<?php esc_html_e( 'Edit Group', 'fair-membership' ); ?>
			</a>
			<hr class="wp-header-end">

			<?php $this->display_view_notices(); ?>

			<div class="card">
				<h2><?php esc_html_e( 'Group Details', 'fair-membership' ); ?></h2>
				<table class="form-table" role="presentation">
					<tbody>
						<tr>
							<th scope="row"><?php esc_html_e( 'Name', 'fair-membership' ); ?></th>
							<td><strong><?php echo esc_html( $group['name'] ); ?></strong></td>
						</tr>
						<tr>
							<th scope="row"><?php esc_html_e( 'Description', 'fair-membership' ); ?></th>
							<td><?php echo esc_html( $group['description'] ?: __( 'No description provided.', 'fair-membership' ) ); ?></td>
						</tr>
						<tr>
							<th scope="row"><?php esc_html_e( 'Members', 'fair-membership' ); ?></th>
							<td>
								<strong><?php echo esc_html( number_format_i18n( $group['members'] ) ); ?></strong>
								<?php echo esc_html( _n( 'member', 'members', $group['members'], 'fair-membership' ) ); ?>
							</td>
						</tr>
						<tr>
							<th scope="row"><?php esc_html_e( 'Created', 'fair-membership' ); ?></th>
							<td><?php echo esc_html( date_i18n( get_option( 'date_format' ), strtotime( $group['created'] ) ) ); ?></td>
						</tr>
					</tbody>
				</table>
			</div>

			<?php if ( $group['members'] > 0 ) : ?>
				<div class="card">
					<h2><?php esc_html_e( 'Members', 'fair-membership' ); ?></h2>
					<?php $this->render_members_table( $group_id ); ?>
				</div>
			<?php endif; ?>

			<p>
				<a href="<?php echo esc_url( admin_url( 'admin.php?page=fair-membership' ) ); ?>" class="button">
					&larr; <?php esc_html_e( 'Back to Groups', 'fair-membership' ); ?>
				</a>
			</p>
		</div>
		<?php
	}

	/**
	 * Render group not found page
	 *
	 * @return void
	 */
	private function render_group_not_found() {
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'Group Not Found', 'fair-membership' ); ?></h1>
			<p><?php esc_html_e( 'The requested group could not be found.', 'fair-membership' ); ?></p>
			<p>
				<a href="<?php echo esc_url( admin_url( 'admin.php?page=fair-membership' ) ); ?>" class="button">
					<?php esc_html_e( 'Back to Groups', 'fair-membership' ); ?>
				</a>
			</p>
		</div>
		<?php
	}

	/**
	 * Render members table for a group
	 *
	 * @param int $group_id Group ID.
	 * @return void
	 */
	private function render_members_table( $group_id ) {
		$members = $this->get_sample_members( $group_id );
		?>
		<table class="wp-list-table widefat fixed striped">
			<thead>
				<tr>
					<th scope="col" class="manage-column"><?php esc_html_e( 'User', 'fair-membership' ); ?></th>
					<th scope="col" class="manage-column"><?php esc_html_e( 'Email', 'fair-membership' ); ?></th>
					<th scope="col" class="manage-column"><?php esc_html_e( 'Joined', 'fair-membership' ); ?></th>
					<th scope="col" class="manage-column"><?php esc_html_e( 'Status', 'fair-membership' ); ?></th>
					<th scope="col" class="manage-column"><?php esc_html_e( 'Actions', 'fair-membership' ); ?></th>
				</tr>
			</thead>
			<tbody>
				<?php if ( empty( $members ) ) : ?>
					<tr class="no-items">
						<td colspan="5">
							<?php esc_html_e( 'No members in this group yet.', 'fair-membership' ); ?>
							<p>
								<a href="<?php echo esc_url( admin_url( 'admin.php?page=fair-membership-add-member&group=' . $group_id ) ); ?>" class="button">
									<?php esc_html_e( 'Add Members', 'fair-membership' ); ?>
								</a>
							</p>
						</td>
					</tr>
				<?php else : ?>
					<?php foreach ( $members as $member ) : ?>
						<tr>
							<td><strong><?php echo esc_html( $member['name'] ); ?></strong></td>
							<td>
								<a href="mailto:<?php echo esc_attr( $member['email'] ); ?>">
									<?php echo esc_html( $member['email'] ); ?>
								</a>
							</td>
							<td><?php echo esc_html( date_i18n( get_option( 'date_format' ), strtotime( $member['joined'] ) ) ); ?></td>
							<td>
								<span class="status-badge status-<?php echo esc_attr( strtolower( $member['status'] ) ); ?>">
									<?php echo esc_html( $member['status'] ); ?>
								</span>
							</td>
							<td>
								<a href="<?php echo esc_url( admin_url( 'user-edit.php?user_id=' . $member['id'] ) ); ?>" class="button button-small">
									<?php esc_html_e( 'Edit User', 'fair-membership' ); ?>
								</a>
							</td>
						</tr>
					<?php endforeach; ?>
				<?php endif; ?>
			</tbody>
		</table>

		<?php if ( ! empty( $members ) ) : ?>
			<p class="description">
				<a href="<?php echo esc_url( admin_url( 'admin.php?page=fair-membership-add-member&group=' . $group_id ) ); ?>" class="button">
					<?php esc_html_e( 'Add More Members', 'fair-membership' ); ?>
				</a>
			</p>
		<?php endif; ?>
		<?php
	}

	/**
	 * Display notices for edit page
	 *
	 * @return void
	 */
	private function display_edit_notices() {
		// Notices are handled by the main pages with URL parameters
	}

	/**
	 * Display notices for view page
	 *
	 * @return void
	 */
	private function display_view_notices() {
		if ( isset( $_GET['updated'] ) && $_GET['updated'] ) {
			?>
			<div class="notice notice-success is-dismissible">
				<p><?php esc_html_e( 'Group updated successfully.', 'fair-membership' ); ?></p>
			</div>
			<?php
		}
	}

	/**
	 * Get sample group data (placeholder until database tables are added)
	 *
	 * @param int $group_id Group ID.
	 * @return array|null
	 */
	private function get_sample_group( $group_id ) {
		$groups = array(
			1 => array(
				'id'          => 1,
				'name'        => 'Premium Members',
				'description' => 'Members with premium access to all features',
				'members'     => 25,
				'created'     => '2024-01-15',
			),
			2 => array(
				'id'          => 2,
				'name'        => 'Event Organizers',
				'description' => 'Users who can create and manage events',
				'members'     => 12,
				'created'     => '2024-02-01',
			),
			3 => array(
				'id'          => 3,
				'name'        => 'VIP Access',
				'description' => 'Special access group for VIP members',
				'members'     => 8,
				'created'     => '2024-02-20',
			),
		);

		return isset( $groups[ $group_id ] ) ? $groups[ $group_id ] : null;
	}

	/**
	 * Get sample members data for a group
	 *
	 * @param int $group_id Group ID.
	 * @return array
	 */
	private function get_sample_members( $group_id ) {
		$all_members = array(
			1 => array(
				array(
					'id'     => 1,
					'name'   => 'John Doe',
					'email'  => 'john@example.com',
					'joined' => '2024-01-20',
					'status' => 'Active',
				),
				array(
					'id'     => 2,
					'name'   => 'Jane Smith',
					'email'  => 'jane@example.com',
					'joined' => '2024-01-25',
					'status' => 'Active',
				),
				array(
					'id'     => 3,
					'name'   => 'Bob Wilson',
					'email'  => 'bob@example.com',
					'joined' => '2024-02-01',
					'status' => 'Pending',
				),
			),
			2 => array(
				array(
					'id'     => 4,
					'name'   => 'Alice Johnson',
					'email'  => 'alice@example.com',
					'joined' => '2024-02-05',
					'status' => 'Active',
				),
				array(
					'id'     => 5,
					'name'   => 'Charlie Brown',
					'email'  => 'charlie@example.com',
					'joined' => '2024-02-10',
					'status' => 'Active',
				),
			),
			3 => array(
				array(
					'id'     => 6,
					'name'   => 'Diana Prince',
					'email'  => 'diana@example.com',
					'joined' => '2024-02-22',
					'status' => 'Active',
				),
			),
		);

		return isset( $all_members[ $group_id ] ) ? $all_members[ $group_id ] : array();
	}
}