#pragma once
#include <vector>
#include <cmath>

// DSA Unit 4: AVL Trees node structure
struct AVLNode {
    long long key;
    std::vector<int> debrisIds;
    AVLNode *left;
    AVLNode *right;
    int height;
};

// It generates a unique sector key for spatial mapping
inline long long getSectorKey(Vector3 p) {
    long long bx = (long long) std::floor(p.x / 100.0);
    long long by = (long long) std::floor(p.y / 100.0);
    long long bz = (long long) std::floor(p.z / 100.0);
    return bx * 1000000LL + by * 1000LL + bz;
}

class AVLTree {
    AVLNode *root;

    int getHeight(AVLNode *n) { return n ? n->height : 0; }
    int getBalance(AVLNode *n) { return n ? getHeight(n->left) - getHeight(n->right) : 0; }
    int myMax(int a, int b) { return (a > b) ? a : b; }

    // DSA Unit 4: Rotation of AVL Tree
    AVLNode* rotateRight(AVLNode *y) {
        AVLNode *x = y->left; 
        AVLNode *t2 = x->right;
        x->right = y; 
        y->left = t2;
        y->height = 1 + myMax(getHeight(y->left), getHeight(y->right));
        x->height = 1 + myMax(getHeight(x->left), getHeight(x->right));
        return x;
    }

    AVLNode* rotateLeft(AVLNode *x) {
        AVLNode *y = x->right; 
        AVLNode *t2 = y->left;
        y->left = x; 
        x->right = t2;
        x->height = 1 + myMax(getHeight(x->left), getHeight(x->right));
        y->height = 1 + myMax(getHeight(y->left), getHeight(y->right));
        return y;
    }

    // DSA Unit 4: Insertion in AVL Trees
    AVLNode* insertHelper(AVLNode *node, long long key, int id) {
        if (node == NULL) {
            AVLNode *n = new AVLNode();
            n->key = key; 
            n->debrisIds.push_back(id);
            n->left = NULL; 
            n->right = NULL; 
            n->height = 1;
            return n;
        }
        if (key < node->key) {
            node->left = insertHelper(node->left, key, id);
        } else if (key > node->key) {
            node->right = insertHelper(node->right, key, id);
        } else { 
            node->debrisIds.push_back(id); 
            return node; 
        }

        node->height = 1 + myMax(getHeight(node->left), getHeight(node->right));
        int balance = getBalance(node);

        if (balance > 1 && key < node->left->key) return rotateRight(node);
        if (balance < -1 && key > node->right->key) return rotateLeft(node);
        if (balance > 1 && key > node->left->key) { 
            node->left = rotateLeft(node->left); 
            return rotateRight(node); 
        }
        if (balance < -1 && key < node->right->key) { 
            node->right = rotateRight(node->right); 
            return rotateLeft(node); 
        }
        return node;
    }
};