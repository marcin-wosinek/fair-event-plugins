<?php
/**
 * Group Form component for Fair Membership
 *
 * @package FairMembership
 */

namespace FairMembership\Admin;

defined( 'WPINC' ) || die;

/**
 * Reusable group form component using WordPress form helpers
 */
class GroupForm {

	/**
	 * Group data
	 *
	 * @var array
	 */
	private $group_data;

	/**
	 * Form mode (add or edit)
	 *
	 * @var string
	 */
	private $mode;

	/**
	 * Constructor
	 *
	 * @param array  $group_data Group data array.
	 * @param string $mode Form mode ('add' or 'edit').
	 */
	public function __construct( $group_data = array(), $mode = 'add' ) {
		$this->group_data = wp_parse_args(
			$group_data,
			array(
				'id'          => 0,
				'name'        => '',
				'description' => '',
				'permissions' => array(),
			)
		);
		$this->mode       = $mode;
	}

	/**
	 * Render the form
	 *
	 * @return void
	 */
	public function render() {
		$submit_text = 'add' === $this->mode ? __( 'Add Group', 'fair-membership' ) : __( 'Update Group', 'fair-membership' );
		$action_name = 'add' === $this->mode ? 'fair_membership_add_group' : 'fair_membership_update_group';
		?>
		<form method="post" action="" novalidate="novalidate">
			<?php
			wp_nonce_field( $action_name, 'fair_membership_nonce' );
			if ( 'edit' === $this->mode ) {
				printf( '<input type="hidden" name="group_id" value="%d" />', absint( $this->group_data['id'] ) );
			}
			?>

			<table class="form-table" role="presentation">
				<tbody>
					<?php $this->render_name_field(); ?>
					<?php $this->render_description_field(); ?>
					<?php if ( 'edit' === $this->mode ) : ?>
						<?php $this->render_member_count_field(); ?>
					<?php endif; ?>
					<?php $this->render_permissions_field(); ?>
				</tbody>
			</table>

			<?php submit_button( $submit_text, 'primary', 'submit', true ); ?>
		</form>
		<?php
	}

	/**
	 * Render group name field
	 *
	 * @return void
	 */
	private function render_name_field() {
		?>
		<tr>
			<th scope="row">
				<label for="group_name"><?php esc_html_e( 'Group Name', 'fair-membership' ); ?> <span class="description">(required)</span></label>
			</th>
			<td>
				<input
					name="group_name"
					type="text"
					id="group_name"
					value="<?php echo esc_attr( $this->group_data['name'] ); ?>"
					class="regular-text"
					required
					aria-describedby="group-name-description"
				/>
				<p class="description" id="group-name-description">
					<?php esc_html_e( 'Enter a unique name for this group.', 'fair-membership' ); ?>
				</p>
			</td>
		</tr>
		<?php
	}

	/**
	 * Render group description field
	 *
	 * @return void
	 */
	private function render_description_field() {
		?>
		<tr>
			<th scope="row">
				<label for="group_description"><?php esc_html_e( 'Description', 'fair-membership' ); ?></label>
			</th>
			<td>
				<textarea
					name="group_description"
					id="group_description"
					rows="4"
					cols="50"
					class="large-text"
					aria-describedby="group-description-description"
				><?php echo esc_textarea( $this->group_data['description'] ); ?></textarea>
				<p class="description" id="group-description-description">
					<?php esc_html_e( 'Provide a description for this group (optional).', 'fair-membership' ); ?>
				</p>
			</td>
		</tr>
		<?php
	}

	/**
	 * Render member count field (read-only for edit mode)
	 *
	 * @return void
	 */
	private function render_member_count_field() {
		if ( 'edit' !== $this->mode ) {
			return;
		}
		?>
		<tr>
			<th scope="row">
				<?php esc_html_e( 'Members', 'fair-membership' ); ?>
			</th>
			<td>
				<strong><?php echo esc_html( $this->group_data['members'] ?? 0 ); ?></strong>
				<?php esc_html_e( 'members', 'fair-membership' ); ?>
				<p class="description">
					<a href="<?php echo esc_url( admin_url( 'admin.php?page=fair-membership-members&group=' . $this->group_data['id'] ) ); ?>">
						<?php esc_html_e( 'Manage members', 'fair-membership' ); ?>
					</a>
				</p>
			</td>
		</tr>
		<?php
	}

	/**
	 * Render permissions field
	 *
	 * @return void
	 */
	private function render_permissions_field() {
		$available_permissions = $this->get_available_permissions();
		$current_permissions   = (array) $this->group_data['permissions'];
		?>
		<tr>
			<th scope="row">
				<?php esc_html_e( 'Permissions', 'fair-membership' ); ?>
			</th>
			<td>
				<fieldset>
					<legend class="screen-reader-text">
						<?php esc_html_e( 'Group Permissions', 'fair-membership' ); ?>
					</legend>
					<?php foreach ( $available_permissions as $permission => $label ) : ?>
						<label for="permission_<?php echo esc_attr( $permission ); ?>">
							<input
								type="checkbox"
								name="permissions[]"
								id="permission_<?php echo esc_attr( $permission ); ?>"
								value="<?php echo esc_attr( $permission ); ?>"
								<?php checked( in_array( $permission, $current_permissions, true ) ); ?>
							/>
							<?php echo esc_html( $label ); ?>
						</label><br />
					<?php endforeach; ?>
					<p class="description">
						<?php esc_html_e( 'Select the permissions that members of this group should have.', 'fair-membership' ); ?>
					</p>
				</fieldset>
			</td>
		</tr>
		<?php
	}

	/**
	 * Process form submission
	 *
	 * @return array|false Array with success message or false on failure.
	 */
	public function process_submission() {
		// Verify nonce
		if ( ! isset( $_POST['fair_membership_nonce'] ) ) {
			return false;
		}

		$action_name = 'add' === $this->mode ? 'fair_membership_add_group' : 'fair_membership_update_group';

		if ( ! wp_verify_nonce( $_POST['fair_membership_nonce'], $action_name ) ) {
			wp_die( esc_html__( 'Security check failed. Please try again.', 'fair-membership' ) );
		}

		// Sanitize and validate data
		$group_data = $this->sanitize_form_data();

		if ( ! $group_data ) {
			return false;
		}

		// Process based on mode
		if ( 'add' === $this->mode ) {
			return $this->add_group( $group_data );
		} else {
			return $this->update_group( $group_data );
		}
	}

	/**
	 * Sanitize form data
	 *
	 * @return array|false Sanitized data or false on validation failure.
	 */
	private function sanitize_form_data() {
		$errors = array();

		// Group name is required
		$name = isset( $_POST['group_name'] ) ? sanitize_text_field( $_POST['group_name'] ) : '';
		if ( empty( $name ) ) {
			$errors[] = __( 'Group name is required.', 'fair-membership' );
		}

		// Description is optional
		$description = isset( $_POST['group_description'] ) ? sanitize_textarea_field( $_POST['group_description'] ) : '';

		// Permissions
		$permissions = isset( $_POST['permissions'] ) && is_array( $_POST['permissions'] )
			? array_map( 'sanitize_text_field', $_POST['permissions'] )
			: array();

		// Validate permissions against allowed ones
		$valid_permissions = array_keys( $this->get_available_permissions() );
		$permissions       = array_intersect( $permissions, $valid_permissions );

		if ( ! empty( $errors ) ) {
			// Store errors for display
			set_transient( 'fair_membership_form_errors', $errors, 300 );
			return false;
		}

		$data = array(
			'name'        => $name,
			'description' => $description,
			'permissions' => $permissions,
		);

		if ( 'edit' === $this->mode && isset( $_POST['group_id'] ) ) {
			$data['id'] = absint( $_POST['group_id'] );
		}

		return $data;
	}

	/**
	 * Add new group (placeholder)
	 *
	 * @param array $group_data Group data.
	 * @return array Success result.
	 */
	private function add_group( $group_data ) {
		// Placeholder: In real implementation, save to database
		// $group_id = insert_group_into_database( $group_data );

		return array(
			'success'  => true,
			'message'  => __( 'Group added successfully.', 'fair-membership' ),
			'redirect' => admin_url( 'admin.php?page=fair-membership&added=1' ),
		);
	}

	/**
	 * Update existing group (placeholder)
	 *
	 * @param array $group_data Group data.
	 * @return array Success result.
	 */
	private function update_group( $group_data ) {
		// Placeholder: In real implementation, update database
		// update_group_in_database( $group_data['id'], $group_data );

		return array(
			'success'  => true,
			'message'  => __( 'Group updated successfully.', 'fair-membership' ),
			'redirect' => admin_url( 'admin.php?page=fair-membership-group-view&id=' . $group_data['id'] . '&updated=1' ),
		);
	}

	/**
	 * Get available permissions
	 *
	 * @return array Available permissions.
	 */
	private function get_available_permissions() {
		return array(
			'create_events'    => __( 'Create Events', 'fair-membership' ),
			'manage_members'   => __( 'Manage Members', 'fair-membership' ),
			'premium_access'   => __( 'Premium Access', 'fair-membership' ),
			'vip_features'     => __( 'VIP Features', 'fair-membership' ),
			'moderate_content' => __( 'Moderate Content', 'fair-membership' ),
			'view_analytics'   => __( 'View Analytics', 'fair-membership' ),
		);
	}

	/**
	 * Display form errors if any
	 *
	 * @return void
	 */
	public static function display_errors() {
		$errors = get_transient( 'fair_membership_form_errors' );
		if ( $errors ) {
			delete_transient( 'fair_membership_form_errors' );
			?>
			<div class="notice notice-error">
				<p><strong><?php esc_html_e( 'Please correct the following errors:', 'fair-membership' ); ?></strong></p>
				<ul>
					<?php foreach ( $errors as $error ) : ?>
						<li><?php echo esc_html( $error ); ?></li>
					<?php endforeach; ?>
				</ul>
			</div>
			<?php
		}
	}
}