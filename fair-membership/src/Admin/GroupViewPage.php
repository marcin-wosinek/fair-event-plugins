<?php
/**
 * Group view admin page for Fair Membership
 *
 * @package FairMembership
 */

namespace FairMembership\Admin;

use FairMembership\Models\Group;

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
		} elseif ( $group_id && 'delete' === $action ) {
			$this->render_delete_confirmation_page( $group_id );
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
		// Handle delete confirmation
		if ( isset( $_POST['confirm_delete'] ) && $_POST['confirm_delete'] === '1' ) {
			$this->handle_delete_confirmation( $group_id );
			return;
		}

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
	 * Handle delete confirmation
	 *
	 * @param int $group_id Group ID to delete.
	 * @return void
	 */
	private function handle_delete_confirmation( $group_id ) {
		// Verify nonce
		if ( ! isset( $_POST['fair_membership_delete_nonce'] ) || ! wp_verify_nonce( $_POST['fair_membership_delete_nonce'], 'fair_membership_delete_group_confirm' ) ) {
			wp_die( esc_html__( 'Security check failed. Please try again.', 'fair-membership' ) );
		}

		// Verify group_id matches
		if ( ! isset( $_POST['group_id'] ) || absint( $_POST['group_id'] ) !== $group_id ) {
			wp_die( esc_html__( 'Invalid group ID.', 'fair-membership' ) );
		}

		// Get the group to delete
		$group = Group::get_by_id( $group_id );
		if ( ! $group ) {
			wp_die( esc_html__( 'Group not found.', 'fair-membership' ) );
		}

		// Delete the group
		$result = $group->delete();

		if ( $result ) {
			// Redirect to group view with success message
			wp_redirect( admin_url( 'admin.php?page=fair-membership&deleted=1' ) );
			exit;
		} else {
			wp_die( esc_html__( 'Failed to delete group. Please try again.', 'fair-membership' ) );
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
		$group_model = Group::get_by_id( $group_id );

		if ( ! $group_model ) {
			$this->render_group_not_found();
			return;
		}

		$group = $group_model->to_array();
		?>
		<div class="wrap">
			<h1 class="wp-heading-inline">
				<?php echo esc_html( sprintf( __( 'Edit Group: %s', 'fair-membership' ), $group_model->name ) ); ?>
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
		$group_model = Group::get_by_id( $group_id );

		if ( ! $group_model ) {
			$this->render_group_not_found();
			return;
		}
		?>
		<div class="wrap">
			<h1 class="wp-heading-inline">
				<?php echo esc_html( $group_model->name ); ?>
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
							<td><strong><?php echo esc_html( $group_model->name ); ?></strong></td>
						</tr>
						<tr>
							<th scope="row"><?php esc_html_e( 'Slug', 'fair-membership' ); ?></th>
							<td><code><?php echo esc_html( $group_model->slug ); ?></code></td>
						</tr>
						<tr>
							<th scope="row"><?php esc_html_e( 'Description', 'fair-membership' ); ?></th>
							<td><?php echo esc_html( $group_model->description ?: __( 'No description provided.', 'fair-membership' ) ); ?></td>
						</tr>
						<tr>
							<th scope="row"><?php esc_html_e( 'Access Control', 'fair-membership' ); ?></th>
							<td>
								<?php echo $this->format_access_control_display( $group_model->access_control ); ?>
							</td>
						</tr>
						<tr>
							<th scope="row"><?php esc_html_e( 'Status', 'fair-membership' ); ?></th>
							<td>
								<span class="status-badge status-<?php echo esc_attr( strtolower( $group_model->status ) ); ?>">
									<?php echo esc_html( ucfirst( $group_model->status ) ); ?>
								</span>
							</td>
						</tr>
						<tr>
							<th scope="row"><?php esc_html_e( 'Members', 'fair-membership' ); ?></th>
							<td>
								<strong><?php echo esc_html( number_format_i18n( 0 ) ); ?></strong>
								<?php echo esc_html( _n( 'member', 'members', 0, 'fair-membership' ) ); ?>
								<p class="description"><?php esc_html_e( 'Member functionality will be available once membership tables are implemented.', 'fair-membership' ); ?></p>
							</td>
						</tr>
						<tr>
							<th scope="row"><?php esc_html_e( 'Created', 'fair-membership' ); ?></th>
							<td><?php echo esc_html( mysql2date( get_option( 'date_format' ) . ' ' . get_option( 'time_format' ), $group_model->created_at ) ); ?></td>
						</tr>
						<tr>
							<th scope="row"><?php esc_html_e( 'Last Updated', 'fair-membership' ); ?></th>
							<td><?php echo esc_html( mysql2date( get_option( 'date_format' ) . ' ' . get_option( 'time_format' ), $group_model->updated_at ) ); ?></td>
						</tr>
					</tbody>
				</table>
			</div>

			<?php if ( false ) : // Disable members section until membership table exists ?>
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
	 * Render delete confirmation page
	 *
	 * @param int $group_id Group ID to delete.
	 * @return void
	 */
	private function render_delete_confirmation_page( $group_id ) {
		// Verify nonce
		if ( ! isset( $_GET['_wpnonce'] ) || ! wp_verify_nonce( $_GET['_wpnonce'], 'fair_membership_delete_group' ) ) {
			wp_die( esc_html__( 'Security check failed. Please try again.', 'fair-membership' ) );
		}

		$group_model = Group::get_by_id( $group_id );

		if ( ! $group_model ) {
			$this->render_group_not_found();
			return;
		}

		?>
		<div class="wrap">
			<h1 class="wp-heading-inline">
				<?php esc_html_e( 'Delete Group', 'fair-membership' ); ?>
			</h1>
			<hr class="wp-header-end">

			<div class="notice notice-warning">
				<p>
					<strong><?php esc_html_e( 'Warning:', 'fair-membership' ); ?></strong>
					<?php esc_html_e( 'You are about to permanently delete this group. This action cannot be undone.', 'fair-membership' ); ?>
				</p>
			</div>

			<div class="card">
				<h2><?php esc_html_e( 'Group to be deleted:', 'fair-membership' ); ?></h2>
				<table class="form-table" role="presentation">
					<tbody>
						<tr>
							<th scope="row"><?php esc_html_e( 'Name', 'fair-membership' ); ?></th>
							<td><strong><?php echo esc_html( $group_model->name ); ?></strong></td>
						</tr>
						<tr>
							<th scope="row"><?php esc_html_e( 'Description', 'fair-membership' ); ?></th>
							<td><?php echo esc_html( $group_model->description ?: __( 'No description provided.', 'fair-membership' ) ); ?></td>
						</tr>
						<tr>
							<th scope="row"><?php esc_html_e( 'Access Control', 'fair-membership' ); ?></th>
							<td><?php echo esc_html( ucfirst( $group_model->access_control ) ); ?></td>
						</tr>
					</tbody>
				</table>
			</div>

			<p><?php esc_html_e( 'Are you sure you want to delete this group?', 'fair-membership' ); ?></p>

			<form method="post" action="" style="display: inline;">
				<?php wp_nonce_field( 'fair_membership_delete_group_confirm', 'fair_membership_delete_nonce' ); ?>
				<input type="hidden" name="group_id" value="<?php echo absint( $group_id ); ?>" />
				<input type="hidden" name="confirm_delete" value="1" />
				<?php submit_button( __( 'Yes, Delete Group', 'fair-membership' ), 'delete', 'submit', false ); ?>
			</form>

			<a href="<?php echo esc_url( admin_url( 'admin.php?page=fair-membership-group-view&id=' . $group_id ) ); ?>" class="button" style="margin-left: 10px;">
				<?php esc_html_e( 'No, Cancel', 'fair-membership' ); ?>
			</a>
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
	 * Format access control for display
	 *
	 * @param string $access_control Access control value.
	 * @return string
	 */
	private function format_access_control_display( $access_control ) {
		$labels = array(
			'open'    => array(
				'label'       => __( 'Open', 'fair-membership' ),
				'description' => __( 'Users can join this group themselves', 'fair-membership' ),
			),
			'managed' => array(
				'label'       => __( 'Managed', 'fair-membership' ),
				'description' => __( 'Only administrators can add or remove members', 'fair-membership' ),
			),
		);

		$config = isset( $labels[ $access_control ] ) ? $labels[ $access_control ] : array(
			'label'       => ucfirst( $access_control ),
			'description' => '',
		);

		return sprintf(
			'<strong>%s</strong><br><span class="description">%s</span>',
			esc_html( $config['label'] ),
			esc_html( $config['description'] )
		);
	}
}