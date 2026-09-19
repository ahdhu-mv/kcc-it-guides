---
title: Resizing an LVM disk after growing the virtual disk
description: Extend the partition, physical volume, logical volume and filesystem in the correct order (Proxmox, AWS, VMware)
updated: 2026-09-19
---

Use this after increasing a VM's virtual disk size in the hypervisor or
cloud console (Proxmox, AWS, VMware) — the four steps below make Ubuntu
actually see and use that extra space.

::: callout The virtual disk itself must already be bigger
This guide only covers the OS-level side. Increase the disk size in
Proxmox/AWS/VMware first and reboot if the hypervisor needs it — none of
the commands below do that part.
:::

The device and volume names below (`/dev/vda3`,
`ubuntu--vg-ubuntu--lv`) match a default single-disk Ubuntu install. If
yours differs, check first with `lsblk` (for the partition) and `sudo
lvs` (for the logical volume's actual name).

## Resize, in this exact order

::: steps
1. **Grow the partition**
   `sudo growpart /dev/vda 3` — extends partition 3 on disk `/dev/vda`
   to fill the newly available space. This has to happen before the
   next step; LVM can't recognize space the partition table doesn't
   know about yet.

2. **Tell LVM about the new partition size**
   `sudo pvresize /dev/vda3` — updates the physical volume to match.

3. **Extend the logical volume**
   `sudo lvextend -l +100%FREE /dev/mapper/ubuntu--vg-ubuntu--lv` —
   grows the LV to consume all of the volume group's free space.

4. **Resize the filesystem**
   `sudo resize2fs /dev/mapper/ubuntu--vg-ubuntu--lv` — this is the
   step that actually makes the extra space usable; the previous three
   steps just made room for it.
:::

## If it's XFS instead of ext4

Replace step 4 with `sudo xfs_growfs /` — note this one takes a
**mount point**, not a device path, unlike `resize2fs`.

## Confirm it worked

`df -h` should now show the filesystem's new, larger size. `lsblk` is
useful too, to see the partition/LV sizes at a glance if something
looks off.
